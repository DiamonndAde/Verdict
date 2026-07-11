//! # Verdict — challenge a friend, settle by cryptographic proof.
//!
//! A 1v1 wager escrow whose only source of truth is a TxLINE Merkle proof of what actually
//! happened in the match. Design constraints that shaped every instruction below:
//!
//! * **No admin key.** Nothing in this program can move vault funds except `settle` (against
//!   a verified proof), `cancel` (pre-acceptance refund), and `refund_expired` (50/50 after
//!   the deadline). There is no authority that can pay itself.
//! * **The settler supplies proofs, never terms.** `settle` is permissionless, but its only
//!   argument is Merkle proof material. The predicate is read from the market account written
//!   at creation. A settler cannot describe the bet, only prove the facts.
//! * **Final records only.** Every proven stat leaf must carry `period == 100`
//!   (`game_finalised`). A halftime snapshot is a validly-provable state that the oracle
//!   will verify — this program refuses it, which is what stops a losing party from
//!   settling early while the score still favours them.

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod txoracle_cpi;

use instructions::*;
use state::Predicate;
use txoracle_cpi::StatValidationInput;

declare_id!("GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e");

#[program]
pub mod verdict {
    use super::*;

    /// Open a challenge: escrow the creator's stake behind a predicate on a fixture.
    /// The creator's side is the predicate being TRUE.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        seed: u64,
        fixture_id: i64,
        stake: u64,
        predicate: Predicate,
        settle_after_ms: i64,
        expiry_unix: i64,
    ) -> Result<()> {
        create_market::handler(
            ctx,
            seed,
            fixture_id,
            stake,
            predicate,
            settle_after_ms,
            expiry_unix,
        )
    }

    /// Take the other side, matching the creator's stake. Open -> Active.
    pub fn accept_market(ctx: Context<AcceptMarket>) -> Result<()> {
        accept_market::handler(ctx)
    }

    /// Withdraw an unaccepted challenge. Open -> Cancelled.
    pub fn cancel_market(ctx: Context<CancelMarket>) -> Result<()> {
        cancel_market::handler(ctx)
    }

    /// Settle against a TxLINE proof. Permissionless. Active -> Settled.
    pub fn settle(ctx: Context<Settle>, payload: StatValidationInput) -> Result<()> {
        settle::handler(ctx, payload)
    }

    /// Unwind a market that never produced a provable result. Active -> Refunded.
    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        refund_expired::handler(ctx)
    }
}
