use anchor_lang::prelude::*;

declare_id!("GcEBPhKczXmkV6CmPqUQ2TpNS5PnbjL7RECv7yCW5U8e");

// Market lifecycle + settlement land in milestone 4/5. The settle instruction CPIs into
// the TxLINE txoracle program; its ID is pinned here so it can never be substituted.
pub const TXORACLE_PROGRAM_ID: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

#[program]
pub mod verdict {
    use super::*;
}
