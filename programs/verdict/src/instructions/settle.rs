use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey::Pubkey;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::errors::VerdictError;
use crate::state::{Market, MarketStatus, Outcome, FINAL_PERIOD, MARKET_SEED};
use crate::txoracle_cpi::{
    self, StatValidationInput, DAILY_SCORES_ROOTS_SEED, TXORACLE_PROGRAM_ID,
};

#[derive(Accounts)]
pub struct Settle<'info> {
    /// Permissionless. Winner, loser, or a passing stranger — the settler only pays the fee
    /// and supplies proof material. They cannot influence who wins: the terms come from the
    /// market account and the verdict comes from the oracle.
    pub settler: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.creator.as_ref(), &market.seed.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(mut, address = market.vault)]
    pub vault: Account<'info, TokenAccount>,

    /// Both parties' token accounts are required up front because the winner is not known
    /// until the oracle answers. The mint is pinned here; ownership is bound in the handler
    /// AFTER the status guard resolves the taker, so a settle attempt before acceptance
    /// fails with a clean `MarketNotActive` rather than a token-account error.
    #[account(mut, constraint = creator_token_account.mint == market.mint @ VerdictError::WrongMint)]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(mut, constraint = taker_token_account.mint == market.mint @ VerdictError::WrongMint)]
    pub taker_token_account: Account<'info, TokenAccount>,

    /// CHECK: pinned to TXORACLE_PROGRAM_ID inside `txoracle_cpi::validate_stat_v2` before
    /// it is ever invoked. [CPI SAFETY: arbitrary CPI]
    pub txoracle_program: UncheckedAccount<'info>,

    /// CHECK: verified in the handler to be the oracle-owned PDA for this proof's epoch day,
    /// and re-checked for oracle ownership inside the CPI helper.
    pub daily_scores_roots: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

/// Settles the market against a TxLINE Merkle proof.
///
/// `payload` is the ONLY settler-supplied input, and it is nothing but proof material:
/// the summary, the Merkle paths, and the stat leaves. The predicate — stat keys, operator,
/// threshold, comparison — is read from the market account written at creation, compiled
/// into the oracle's strategy on-chain, and never accepted from the settler.
///
/// Every gate below is checked against the *same* `payload` struct that is then serialized
/// into the CPI, so the fields we gate on (`key`, `period`, `fixture_id`, timestamps) are
/// exactly the fields the oracle Merkle-verifies. There is no parallel, unverified copy of
/// the data anywhere in this path.
pub fn handler(ctx: Context<Settle>, payload: StatValidationInput) -> Result<()> {
    let market = &ctx.accounts.market;

    // GATE 7 — double-settle / wrong-phase guard. Settling twice, or before a taker has
    // escrowed, is impossible.
    require!(
        market.status == MarketStatus::Active,
        VerdictError::MarketNotActive
    );
    let taker = market.taker.ok_or(VerdictError::MarketNotActive)?;

    // Bind the payout destinations to the two parties now that the taker is known. Doing
    // this in the handler (not an account constraint) keeps the status guard above as the
    // first thing a settler hits.
    require_keys_eq!(
        ctx.accounts.creator_token_account.owner,
        market.creator,
        VerdictError::InvalidTokenAccountOwner
    );
    require_keys_eq!(
        ctx.accounts.taker_token_account.owner,
        taker,
        VerdictError::InvalidTokenAccountOwner
    );

    payload.check_bounds()?;

    // GATE 2 — fixture binding. A perfectly valid proof from a *different* match is still
    // not a proof about this wager.
    require!(
        payload.fixture_summary.fixture_id == market.fixture_id,
        VerdictError::FixtureMismatch
    );

    // GATE 5 — time gate (defense in depth behind the period gate). The summary is itself
    // Merkle-verified, so its max_timestamp cannot be inflated to fake a late proof.
    require!(
        payload.fixture_summary.update_stats.max_timestamp >= market.settle_after_ms,
        VerdictError::ProofTooEarly
    );

    // GATE 3 + GATE 4 — the stat leaves must be the ones this market's predicate names, in
    // the order the strategy indexes them, and each must come from the game_finalised record.
    //
    // This is the early-settlement defense. A halftime snapshot is a *validly provable*
    // state: the oracle will happily verify it (confirmed on devnet — see the measurement
    // report). Without this gate, a losing party could settle at the moment the score
    // favoured them. `period` is inside the hashed leaf, so relabelling a halftime stat as
    // final breaks the Merkle proof and the oracle rejects it.
    require!(
        payload.stats.len() == market.predicate.stat_count(),
        VerdictError::WrongStatCount
    );
    require!(
        payload.stats[0].stat.key == market.predicate.stat1_key,
        VerdictError::StatKeyMismatch
    );
    require!(
        payload.stats[0].stat.period == FINAL_PERIOD,
        VerdictError::NotFinalRecord
    );
    if let Some(key2) = market.predicate.stat2_key {
        require!(
            payload.stats[1].stat.key == key2,
            VerdictError::StatKeyMismatch
        );
        require!(
            payload.stats[1].stat.period == FINAL_PERIOD,
            VerdictError::NotFinalRecord
        );
    }

    // The oracle keys its roots PDA off the proof's own timestamp. Deriving it ourselves and
    // pinning the account means a settler cannot point us at some other day's root account.
    let epoch_day = payload.epoch_day()?;
    let (expected_roots, _) = Pubkey::find_program_address(
        &[DAILY_SCORES_ROOTS_SEED, &epoch_day.to_le_bytes()],
        &TXORACLE_PROGRAM_ID,
    );
    require_keys_eq!(
        ctx.accounts.daily_scores_roots.key(),
        expected_roots,
        VerdictError::WrongRootsAccount
    );

    // Terms come from state, never from the settler.
    let strategy = market.predicate.to_strategy()?;

    // GATE 1 + GATE 6 live inside this call: the callee is pinned before `invoke`, and the
    // return-data producer is authenticated before the boolean is read.
    let predicate_holds = txoracle_cpi::validate_stat_v2(
        &ctx.accounts.txoracle_program.to_account_info(),
        &ctx.accounts.daily_scores_roots.to_account_info(),
        &payload,
        &strategy,
    )?;

    // The creator's side of the wager is the predicate being TRUE.
    let (winner, winner_token_account) = if predicate_holds {
        (
            market.creator,
            ctx.accounts.creator_token_account.to_account_info(),
        )
    } else {
        (taker, ctx.accounts.taker_token_account.to_account_info())
    };

    // [CPI SAFETY: stale account read] Never read balances across a CPI boundary without a
    // reload. The oracle CPI is read-only and never sees the vault, but the discipline is
    // cheap and the alternative is a silent failure mode.
    ctx.accounts.vault.reload()?;
    let pot = ctx.accounts.vault.amount;
    require!(pot > 0, VerdictError::EmptyVault);

    let creator = market.creator;
    let seed_bytes = market.seed.to_le_bytes();
    let bump = market.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[MARKET_SEED, creator.as_ref(), &seed_bytes, &[bump]]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: winner_token_account,
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        pot,
    )?;

    let stat1_value = payload.stats[0].stat.value;
    let stat2_value = payload.stats.get(1).map(|leaf| leaf.stat.value);
    let proof_max_ts = payload.fixture_summary.update_stats.max_timestamp;
    let settled_at_unix = Clock::get()?.unix_timestamp;

    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Settled;
    market.outcome = Some(Outcome {
        winner,
        predicate_result: predicate_holds,
        stat1_value,
        stat2_value,
        proof_max_ts,
        settled_at_unix,
        payout: pot,
    });

    emit!(MarketSettled {
        market: market.key(),
        fixture_id: market.fixture_id,
        winner,
        predicate_result: predicate_holds,
        stat1_value,
        stat2_value,
        payout: pot,
        settler: ctx.accounts.settler.key(),
    });

    Ok(())
}

#[event]
pub struct MarketSettled {
    pub market: Pubkey,
    pub fixture_id: i64,
    pub winner: Pubkey,
    pub predicate_result: bool,
    pub stat1_value: i32,
    pub stat2_value: Option<i32>,
    pub payout: u64,
    pub settler: Pubkey,
}
