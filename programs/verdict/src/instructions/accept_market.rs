use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VerdictError;
use crate::state::{Market, MarketStatus, MARKET_SEED};

#[derive(Accounts)]
pub struct AcceptMarket<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,

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
        constraint = taker_token_account.mint == market.mint @ VerdictError::EmptyVault,
        constraint = taker_token_account.owner == taker.key() @ VerdictError::EmptyVault,
    )]
    pub taker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<AcceptMarket>) -> Result<()> {
    let market = &ctx.accounts.market;
    require!(market.status == MarketStatus::Open, VerdictError::MarketNotOpen);
    require!(
        ctx.accounts.taker.key() != market.creator,
        VerdictError::SelfAccept
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.taker_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
            },
        ),
        market.stake,
    )?;

    let market = &mut ctx.accounts.market;
    market.taker = Some(ctx.accounts.taker.key());
    market.status = MarketStatus::Active;

    Ok(())
}
