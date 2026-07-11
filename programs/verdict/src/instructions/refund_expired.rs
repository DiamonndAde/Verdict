use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VerdictError;
use crate::state::{Market, MarketStatus, MARKET_SEED};

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    /// Permissionless: anyone may trigger the refund. The destinations are pinned to the
    /// two parties, so a third-party caller can only return money to its rightful owners —
    /// and the market can always be unwound even if both parties go dark.
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.seed.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut, constraint = creator_token_account.mint == market.mint @ VerdictError::WrongMint)]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = taker_token_account.mint == market.mint @ VerdictError::WrongMint)]
    pub taker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// The safety valve for matches that never produce a provable result — abandoned,
/// cancelled, postponed, or simply never finalised by the feed. After `expiry_unix`, the
/// pot splits 50/50 and nobody's stake is trapped.
pub fn handler(ctx: Context<RefundExpired>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Active,
        VerdictError::MarketNotActive
    );
    let taker = ctx.accounts.market.taker.ok_or(VerdictError::MarketNotActive)?;
    let now_unix = Clock::get()?.unix_timestamp;
    require!(
        now_unix >= ctx.accounts.market.expiry_unix,
        VerdictError::NotExpired
    );

    // Bind refund destinations to the two parties (handler-side, same rationale as settle).
    require_keys_eq!(
        ctx.accounts.creator_token_account.owner,
        ctx.accounts.market.creator,
        VerdictError::InvalidTokenAccountOwner
    );
    require_keys_eq!(
        ctx.accounts.taker_token_account.owner,
        taker,
        VerdictError::InvalidTokenAccountOwner
    );

    let pot = ctx.accounts.vault.amount;
    require!(pot > 0, VerdictError::EmptyVault);

    // Odd lamports (only reachable if someone donated to the vault) round to the creator.
    let taker_share = pot / 2;
    let creator_share = pot.checked_sub(taker_share).ok_or(VerdictError::Overflow)?;

    let creator = ctx.accounts.market.creator;
    let seed_bytes = ctx.accounts.market.seed.to_le_bytes();
    let bump = ctx.accounts.market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[MARKET_SEED, creator.as_ref(), &seed_bytes, &[bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.creator_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        creator_share,
    )?;

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.taker_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        taker_share,
    )?;

    ctx.accounts.market.status = MarketStatus::Refunded;
    Ok(())
}
