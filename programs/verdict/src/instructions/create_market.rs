use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::VerdictError;
use crate::state::{Market, MarketStatus, Predicate, MARKET_SEED};

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, creator.key().as_ref(), &seed.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    pub mint: Account<'info, Mint>,

    /// Escrow for both stakes. Authority is the market PDA — there is no admin key that can
    /// move these funds, only the program's own instructions.
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.mint == mint.key() @ VerdictError::EmptyVault,
        constraint = creator_token_account.owner == creator.key() @ VerdictError::EmptyVault,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<CreateMarket>,
    seed: u64,
    fixture_id: i64,
    stake: u64,
    predicate: Predicate,
    settle_after_ms: i64,
    expiry_unix: i64,
) -> Result<()> {
    require!(stake > 0, VerdictError::ZeroStake);
    require!(settle_after_ms > 0, VerdictError::InvalidSettleAfter);
    predicate.validate()?;

    let now_unix = Clock::get()?.unix_timestamp;
    // Expiry must be in the future, and must not fall before the settlement window even
    // opens — otherwise the market could expire into a refund while still provable.
    require!(
        expiry_unix > now_unix && expiry_unix > settle_after_ms / 1000,
        VerdictError::InvalidExpiry
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        stake,
    )?;

    ctx.accounts.market.set_inner(Market {
        creator: ctx.accounts.creator.key(),
        taker: None,
        mint: ctx.accounts.mint.key(),
        vault: ctx.accounts.vault.key(),
        seed,
        fixture_id,
        stake,
        settle_after_ms,
        expiry_unix,
        predicate,
        status: MarketStatus::Open,
        outcome: None,
        // Canonical bump from Anchor's own derivation — the only bump ever used to sign
        // for the vault. [CPI SAFETY: PDA signing]
        bump: ctx.bumps.market,
    });

    Ok(())
}
