-- Migration 0026 - amount paid on site (SOFT TR 4.12.4, TR 4.12.6)
--
-- competitors.paid_amount: what the runner paid at the desk, in whole
-- kronor, for the entry fee, the surcharge and the card rental together
-- (MeOS keeps one Paid per runner, oRunner "Paid"). 0 = nothing paid; the
-- club is then billed by Eventor from the uploaded ResultList (AssignedFee
-- minus PaidAmount).
-- competitors.paid_method: 'cash' or 'swish', for the day's cash-up;
-- NULL = not recorded.
-- Not personal data on its own (an amount and a method, no identity), so
-- retention.ts leaves both when it scrubs name, club and birth year.
--
-- Hand-written like 0011-0025, no snapshot.
ALTER TABLE `competitors` ADD `paid_amount` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `competitors` ADD `paid_method` text;
