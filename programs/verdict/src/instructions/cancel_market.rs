use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VerdictError;
use crate::state::{Market, MarketStatus, MARKET_SEED};

#[derive(Accounts)]
pub struct CancelMarket<'info> {
    #[account(mut, address = market.creator)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.seed.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_token_account.mint == market.mint @ VerdictError::EmptyVault,
        constraint = creator_token_account.owner == creator.key() @ VerdictError::EmptyVault,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Full refund to the creator, only while nobody has accepted. Once a taker escrows, the
/// creator can no longer walk away — the only exits are a proof or expiry.
pub fn handler(ctx: Context<CancelMarket>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Open,
        VerdictError::MarketNotOpen
    );

    let pot = ctx.accounts.vault.amount;
    require!(pot > 0, VerdictError::EmptyVault);

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
        pot,
    )?;

    ctx.accounts.market.status = MarketStatus::Cancelled;
    Ok(())
}
