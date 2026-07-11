use anchor_lang::prelude::*;

use crate::errors::VerdictError;
use crate::txoracle_cpi::{
    BinaryExpression, Comparison, NDimensionalStrategy, StatPredicate, TraderPredicate,
};

pub const MARKET_SEED: &[u8] = b"market";

/// `game_finalised` score records carry period 100 (and statusId 100). Every settlement
/// proof must come from that record: the period lives inside the Merkle-hashed stat leaf,
/// so a settler cannot relabel a halftime stat as final.
pub const FINAL_PERIOD: i32 = 100;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum MarketStatus {
    /// Created and funded by the creator; awaiting a taker.
    Open,
    /// Both sides escrowed; awaiting proof.
    Active,
    /// Settled against a TxLINE proof; the pot has been paid to the winner.
    Settled,
    /// Cancelled before anyone accepted; creator refunded.
    Cancelled,
    /// Expired without a provable result; stakes returned 50/50.
    Refunded,
}

/// The wager's terms, fixed at creation and never supplied by a settler.
///
/// Mirrors the oracle's own predicate vocabulary (`Comparison`, `BinaryExpression`) so the
/// on-chain translation into a validation strategy is an identity mapping — there is no
/// intermediate representation in which terms could be misread.
///
/// Creator's side is the predicate being TRUE.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Predicate {
    /// Periodised TxLINE stat key, e.g. 7 = participant-1 total corners.
    pub stat1_key: u32,
    /// Optional second stat, combined with the first via `op`.
    pub stat2_key: Option<u32>,
    pub op: Option<BinaryExpression>,
    pub threshold: i32,
    pub comparison: Comparison,
}

impl Predicate {
    pub fn validate(&self) -> Result<()> {
        // A second key and an operator are meaningless without each other.
        require!(
            self.stat2_key.is_some() == self.op.is_some(),
            VerdictError::MalformedPredicate
        );
        require!(self.stat1_key != 0, VerdictError::InvalidStatKeys);
        if let Some(k2) = self.stat2_key {
            require!(
                k2 != 0 && k2 != self.stat1_key,
                VerdictError::InvalidStatKeys
            );
        }
        Ok(())
    }

    pub fn stat_count(&self) -> usize {
        if self.stat2_key.is_some() {
            2
        } else {
            1
        }
    }

    /// Compiles the stored terms into the oracle's strategy. Indices are positions in the
    /// proof payload's `stats` vector; `settle` separately requires that payload stat *i*
    /// carries exactly this predicate's key *i*, which is what binds these indices to the
    /// Merkle-verified leaves.
    pub fn to_strategy(&self) -> Result<NDimensionalStrategy> {
        let predicate = TraderPredicate {
            threshold: self.threshold,
            comparison: self.comparison,
        };
        let discrete = match (self.stat2_key, self.op) {
            (Some(_), Some(op)) => StatPredicate::Binary {
                index_a: 0,
                index_b: 1,
                op,
                predicate,
            },
            (None, None) => StatPredicate::Single {
                index: 0,
                predicate,
            },
            _ => return err!(VerdictError::MalformedPredicate),
        };
        Ok(NDimensionalStrategy {
            geometric_targets: vec![],
            distance_predicate: None,
            discrete_predicates: vec![discrete],
        })
    }
}

/// What the chain recorded when the market settled — the receipt's source of truth.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct Outcome {
    pub winner: Pubkey,
    /// The oracle's verdict on the stored predicate.
    pub predicate_result: bool,
    /// The Merkle-proven stat values that produced that verdict.
    pub stat1_value: i32,
    pub stat2_value: Option<i32>,
    /// Latest timestamp covered by the proven summary (epoch ms) — when the data was final.
    pub proof_max_ts: i64,
    /// When the chain settled it (unix seconds).
    pub settled_at_unix: i64,
    pub payout: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub creator: Pubkey,
    pub taker: Option<Pubkey>,
    pub mint: Pubkey,
    pub vault: Pubkey,
    /// Creator-chosen nonce; part of the market PDA so one wallet can run many challenges.
    pub seed: u64,
    pub fixture_id: i64,
    /// Each side stakes exactly this much; the pot is 2x.
    pub stake: u64,
    /// Epoch MILLISECONDS (TxLINE's time base). Proofs whose summary ends before this are
    /// rejected. Deliberately a different unit from `expiry_unix` — the names carry it.
    pub settle_after_ms: i64,
    /// Unix SECONDS (Solana's `Clock` time base). After this, either side can trigger a
    /// 50/50 refund.
    pub expiry_unix: i64,
    pub predicate: Predicate,
    pub status: MarketStatus,
    pub outcome: Option<Outcome>,
    pub bump: u8,
}
