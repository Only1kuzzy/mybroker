-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard)
-- to add the new columns and table required for the investment plan feature.

-- 1. Add new columns to the users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS investment_amount  NUMERIC(12, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_method     TEXT           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS investment_status  TEXT           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fee_required       NUMERIC(12, 2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fee_paid           NUMERIC(12, 2) DEFAULT 0;

-- 2. Create the payment_settings table (stores crypto wallet + bank details)
CREATE TABLE IF NOT EXISTS payment_settings (
  id                  INT PRIMARY KEY DEFAULT 1,
  crypto_wallet       TEXT DEFAULT '',
  crypto_network      TEXT DEFAULT 'Bitcoin (BTC)',
  bank_name           TEXT DEFAULT '',
  bank_account_name   TEXT DEFAULT '',
  bank_account_number TEXT DEFAULT '',
  bank_routing        TEXT DEFAULT '',
  bank_swift          TEXT DEFAULT '',
  withdrawal_fee      NUMERIC(12, 2) DEFAULT 0,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Add withdrawal_fee to existing payment_settings table if it already exists
ALTER TABLE payment_settings
  ADD COLUMN IF NOT EXISTS withdrawal_fee NUMERIC(12, 2) DEFAULT 0;

-- Ensure only one row ever exists (id=1)
-- Insert default row if it doesn't exist
INSERT INTO payment_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
