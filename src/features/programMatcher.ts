/**
 * ProgramMatcher — Match patients to 600+ prescription assistance programs
 * including manufacturer PAPs, state programs, 340B pharmacies, and copay cards.
 */

import { z } from 'zod';

export const PatientIntakeSchema = z.object({
  patientId: z.string().uuid(),
  age: z.number().int().min(0).max(150),
  zipCode: z.string().regex(/^\d{5}$/),
  householdSize: z.number().int().min(1).max(20),
  annualIncome: z.number().nonnegative(),
  insuranceType: z.enum(['none', 'medicare', 'medicaid', 'private', 'va', 'tricare', 'marketplace']),
  insuranceCoversRx: z.boolean(),
  medications: z.array(z.object({
    name: z.string(), genericName: z.string().optional(), dosage: z.string(), frequency: z.string(),
    currentMonthlyCost: z.number().nonnegative(), ndc: z.string().optional(),
    manufacturer: z.string().optional(), diagnosis: z.string().optional(),
  })),
  diagnoses: z.array(z.string()),
  veteran: z.boolean().default(false),
  disabled: z.boolean().default(false),
});

export const AssistanceProgramSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['manufacturer_pap', 'state_program', '340b_pharmacy', 'copay_card', 'foundation', 'discount_program', 'generic_program', 'mail_order']),
  sponsor: z.string(),
  coveredMedications: z.array(z.string()),
  eligibility: z.object({
    maxIncomeFPL: z.number().positive().optional(),
    insuranceRequired: z.enum(['required', 'prohibited', 'either']),
    ageMin: z.number().int().optional(), ageMax: z.number().int().optional(),
    citizenshipRequired: z.boolean().optional(),
    diagnosisRequired: z.array(z.string()).optional(),
  }),
  benefit: z.object({
    type: z.enum(['free_medication', 'copay_reduction', 'discount_percentage', 'flat_price']),
    value: z.string(),
    estimatedMonthlySavings: z.number().nonnegative().optional(),
  }),
  applicationProcess: z.object({
    url: z.string().url().optional(),
    phone: z.string().optional(),
    requiresPhysician: z.boolean(),
    processingDays: z.number().int().positive(),
    renewalMonths: z.number().int().positive(),
  }),
  active: z.boolean(),
});

export const MatchResultSchema = z.object({
  patientId: z.string().uuid(),
  matchedAt: z.string().datetime(),
  totalMonthlyCostBefore: z.number(),
  totalMonthlyCostAfter: z.number(),
  totalAnnualSavings: z.number(),
  matches: z.array(z.object({
    medication: z.string(),
    currentCost: z.number(),
    programs: z.array(z.object({
      programId: z.string(), programName: z.string(), type: z.string(),
      estimatedCostAfter: z.number(), savings: z.number(),
      matchConfidence: z.enum(['high', 'medium', 'low']),
      applicationUrl: z.string().url().optional(),
      requiresPhysician: z.boolean(),
    })),
    bestOption: z.string(),
  })),
  genericAlternatives: z.array(z.object({
    brandName: z.string(), genericName: z.string(), genericCost: z.number(), brandCost: z.number(), savings: z.number(),
    therapeuticallyEquivalent: z.boolean(),
  })),
});

export type PatientIntake = z.infer<typeof PatientIntakeSchema>;
export type AssistanceProgram = z.infer<typeof AssistanceProgramSchema>;
export type MatchResult = z.infer<typeof MatchResultSchema>;

const FPL_2024: Record<number, number> = { 1: 15060, 2: 20440, 3: 25820, 4: 31200, 5: 36580, 6: 41960, 7: 47340, 8: 52720 };

export function calculateFPLPercentage(income: number, householdSize: number): number {
  const fpl = FPL_2024[Math.min(householdSize, 8)] ?? (FPL_2024[8]! + (householdSize - 8) * 5380);
  return Math.round((income / fpl) * 100);
}

export function matchPrograms(patient: PatientIntake, programs: AssistanceProgram[]): MatchResult {
  const fplPct = calculateFPLPercentage(patient.annualIncome, patient.householdSize);
  const matches: MatchResult['matches'] = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const med of patient.medications) {
    totalBefore += med.currentMonthlyCost;
    const medName = (med.genericName ?? med.name).toLowerCase();

    const eligible = programs.filter(p => {
      if (!p.active) return false;
      const coversMed = p.coveredMedications.some(c => c.toLowerCase().includes(medName) || medName.includes(c.toLowerCase()));
      if (!coversMed) return false;
      if (p.eligibility.maxIncomeFPL && fplPct > p.eligibility.maxIncomeFPL) return false;
      if (p.eligibility.insuranceRequired === 'required' && patient.insuranceType === 'none') return false;
      if (p.eligibility.insuranceRequired === 'prohibited' && patient.insuranceType !== 'none') return false;
      if (p.eligibility.ageMin && patient.age < p.eligibility.ageMin) return false;
      if (p.eligibility.ageMax && patient.age > p.eligibility.ageMax) return false;
      return true;
    }).map(p => {
      const estimatedCost = p.benefit.type === 'free_medication' ? 0
        : p.benefit.type === 'flat_price' ? parseFloat(p.benefit.value) || 10
        : p.benefit.type === 'discount_percentage' ? med.currentMonthlyCost * (1 - (parseFloat(p.benefit.value) || 50) / 100)
        : med.currentMonthlyCost * 0.5;

      return {
        programId: p.id, programName: p.name, type: p.type,
        estimatedCostAfter: Math.round(estimatedCost * 100) / 100,
        savings: Math.round((med.currentMonthlyCost - estimatedCost) * 100) / 100,
        matchConfidence: (fplPct <= (p.eligibility.maxIncomeFPL ?? 400) * 0.8 ? 'high' : 'medium') as 'high' | 'medium' | 'low',
        applicationUrl: p.applicationProcess.url,
        requiresPhysician: p.applicationProcess.requiresPhysician,
      };
    }).sort((a, b) => a.estimatedCostAfter - b.estimatedCostAfter);

    const bestCost = eligible[0]?.estimatedCostAfter ?? med.currentMonthlyCost;
    totalAfter += bestCost;

    matches.push({
      medication: med.name, currentCost: med.currentMonthlyCost,
      programs: eligible, bestOption: eligible[0]?.programName ?? 'No programs found',
    });
  }

  return {
    patientId: patient.patientId, matchedAt: new Date().toISOString(),
    totalMonthlyCostBefore: Math.round(totalBefore * 100) / 100,
    totalMonthlyCostAfter: Math.round(totalAfter * 100) / 100,
    totalAnnualSavings: Math.round((totalBefore - totalAfter) * 12 * 100) / 100,
    matches, genericAlternatives: [],
  };
}
