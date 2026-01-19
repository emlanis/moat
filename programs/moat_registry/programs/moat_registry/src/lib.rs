use anchor_lang::prelude::*;

declare_id!("7xrqC43sgnJAc1ozxGsXQBv8Jhw1K3GvhoXiT8F6R84i");

#[program]
pub mod moat_registry {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
