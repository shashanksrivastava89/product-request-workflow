-- Quantities carry up to three decimal places.
--
-- Service work is booked in hours, so a line can legitimately be 1.5 or 0.35 (Corlett Siobhan, 17 Sep
-- 2026). Widening an integer column loses nothing: every existing row keeps its value, and money is
-- rounded to whole yen in application code rather than here, because the rule is per line and not
-- per column.
ALTER TABLE "form_products" ALTER COLUMN "quantity" TYPE DECIMAL(12,3);
