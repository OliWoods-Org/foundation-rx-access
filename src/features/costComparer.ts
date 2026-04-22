/**
 * CostComparer — Compare prescription prices across pharmacies,
 * find generic alternatives via FDA Orange Book, and calculate
 * total annual savings across all optimization strategies.
 */

import { z } from 'zod';

export const PharmacyPriceSchema = z.object({
  pharmacyName: z.string(),
  pharmacyType: z.enum(['retail', 'mail_order', '340b', 'online', 'costplus', 'compounding']),
  address: z.string().optional(),
  distanceMiles: z.number().nonnegative().optional(),
  medication: z.string(),
  dosage: z.string(),
  quantity: z.number().int().positive(),
  price: z.number().nonnegative(),
  pricePerUnit: z.number().nonnegative(),
  withInsurance: z.number().nonnegative().optional(),
  withGoodRxCoupon: z.number().nonnegative().optional(),
  with340B: z.number().nonnegative().optional(),
  available: z.boolean(),
  lastUpdated: z.string().datetime(),
});

export const GenericAlternativeSchema = z.object({
  brandName: z.string(),
  brandManufacturer: z.string(),
  genericName: z.string(),
  genericManufacturers: z.array(z.string()),
  therapeuticEquivalenceCode: z.string().optional(),
  isABRated: z.boolean(),
  brandPrice: z.number(),
  genericPrice: z.number(),
  savings: z.number(),
  savingsPercent: z.number(),
  fdaApprovalDate: z.string().optional(),
  notes: z.string().optional(),
});

export const SavingsReportSchema = z.object({
  patientId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  currentAnnualCost: z.number(),
  optimizedAnnualCost: z.number(),
  totalAnnualSavings: z.number(),
  strategies: z.array(z.object({
    type: z.enum(['generic_switch', 'pharmacy_switch', 'pap_enrollment', 'copay_card', '340b_pharmacy', 'mail_order', 'pill_splitting', 'quantity_discount']),
    medication: z.string(),
    description: z.string(),
    monthlySavings: z.number(),
    annualSavings: z.number(),
    effort: z.enum(['easy', 'moderate', 'complex']),
    requiresPhysician: z.boolean(),
  })),
  pharmacyRecommendation: z.object({
    name: z.string(),
    type: z.string(),
    totalMonthlyCost: z.number(),
    reason: z.string(),
  }).optional(),
});

export type PharmacyPrice = z.infer<typeof PharmacyPriceSchema>;
export type GenericAlternative = z.infer<typeof GenericAlternativeSchema>;
export type SavingsReport = z.infer<typeof SavingsReportSchema>;

export function findCheapestPharmacy(prices: PharmacyPrice[]): PharmacyPrice | null {
  if (prices.length === 0) return null;
  return prices.reduce((cheapest, p) => {
    const pBest = Math.min(p.price, p.withInsurance ?? Infinity, p.withGoodRxCoupon ?? Infinity, p.with340B ?? Infinity);
    const cBest = Math.min(cheapest.price, cheapest.withInsurance ?? Infinity, cheapest.withGoodRxCoupon ?? Infinity, cheapest.with340B ?? Infinity);
    return pBest < cBest ? p : cheapest;
  });
}

export function calculateGenericSavings(alternatives: GenericAlternative[]): { totalAnnualSavings: number; switches: GenericAlternative[] } {
  const abRated = alternatives.filter(a => a.isABRated);
  const totalAnnual = abRated.reduce((sum, a) => sum + a.savings * 12, 0);
  return { totalAnnualSavings: Math.round(totalAnnual * 100) / 100, switches: abRated };
}

export function generateSavingsReport(
  patientId: string,
  medications: Array<{ name: string; monthlyCost: number }>,
  pharmacyPrices: PharmacyPrice[][],
  generics: GenericAlternative[],
  papSavings: Array<{ medication: string; monthlySavings: number }>
): SavingsReport {
  const currentAnnual = medications.reduce((sum, m) => sum + m.monthlyCost * 12, 0);
  const strategies: SavingsReport['strategies'] = [];

  // Generic switches
  for (const generic of generics.filter(g => g.isABRated)) {
    strategies.push({
      type: 'generic_switch', medication: generic.brandName,
      description: `Switch from ${generic.brandName} to ${generic.genericName} (AB-rated equivalent)`,
      monthlySavings: generic.savings, annualSavings: generic.savings * 12,
      effort: 'easy', requiresPhysician: true,
    });
  }

  // PAP enrollment
  for (const pap of papSavings) {
    strategies.push({
      type: 'pap_enrollment', medication: pap.medication,
      description: `Enroll in Patient Assistance Program for ${pap.medication}`,
      monthlySavings: pap.monthlySavings, annualSavings: pap.monthlySavings * 12,
      effort: 'moderate', requiresPhysician: true,
    });
  }

  // Pharmacy switching
  for (let i = 0; i < medications.length && i < pharmacyPrices.length; i++) {
    const cheapest = findCheapestPharmacy(pharmacyPrices[i]);
    if (cheapest) {
      const bestPrice = Math.min(cheapest.price, cheapest.withGoodRxCoupon ?? Infinity, cheapest.with340B ?? Infinity);
      const saving = medications[i].monthlyCost - bestPrice;
      if (saving > 5) {
        strategies.push({
          type: cheapest.pharmacyType === '340b' ? '340b_pharmacy' : cheapest.pharmacyType === 'mail_order' ? 'mail_order' : 'pharmacy_switch',
          medication: medications[i].name,
          description: `Switch to ${cheapest.pharmacyName} for ${medications[i].name} ($${bestPrice}/mo vs $${medications[i].monthlyCost}/mo)`,
          monthlySavings: Math.round(saving * 100) / 100, annualSavings: Math.round(saving * 12 * 100) / 100,
          effort: 'easy', requiresPhysician: false,
        });
      }
    }
  }

  strategies.sort((a, b) => b.annualSavings - a.annualSavings);
  const totalSavings = strategies.reduce((sum, s) => sum + s.annualSavings, 0);

  return {
    patientId, generatedAt: new Date().toISOString(),
    currentAnnualCost: Math.round(currentAnnual * 100) / 100,
    optimizedAnnualCost: Math.round((currentAnnual - totalSavings) * 100) / 100,
    totalAnnualSavings: Math.round(totalSavings * 100) / 100,
    strategies,
  };
}
