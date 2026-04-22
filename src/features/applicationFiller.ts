/**
 * ApplicationFiller — Auto-generate and pre-fill PAP applications,
 * track renewal deadlines, and manage application lifecycle.
 */

import { z } from 'zod';

export const ApplicationSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  programId: z.string(),
  programName: z.string(),
  medication: z.string(),
  status: z.enum(['draft', 'ready_to_submit', 'submitted', 'pending_review', 'approved', 'denied', 'renewal_due', 'expired']),
  createdAt: z.string().datetime(),
  submittedAt: z.string().datetime().optional(),
  approvedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  renewalDeadline: z.string().datetime().optional(),
  fields: z.array(z.object({
    fieldName: z.string(), fieldType: z.enum(['text', 'number', 'date', 'select', 'checkbox', 'signature']),
    value: z.string().optional(), required: z.boolean(), autoFilled: z.boolean(),
  })),
  requiredDocuments: z.array(z.object({
    type: z.enum(['income_proof', 'insurance_card', 'prescription', 'tax_return', 'id', 'physician_letter']),
    description: z.string(), attached: z.boolean(),
  })),
  physicianSignatureRequired: z.boolean(),
  notes: z.array(z.object({ date: z.string().datetime(), note: z.string() })),
});

export const RenewalTrackerSchema = z.object({
  patientId: z.string().uuid(),
  activeApplications: z.number().int().nonnegative(),
  upcomingRenewals: z.array(z.object({
    applicationId: z.string(), programName: z.string(), medication: z.string(),
    renewalDeadline: z.string(), daysRemaining: z.number().int(), autoRenewable: z.boolean(),
  })),
  expiredApplications: z.array(z.object({
    applicationId: z.string(), programName: z.string(), expiredAt: z.string(), reapplyUrl: z.string().url().optional(),
  })),
  monthlySavingsAtRisk: z.number(),
});

export type Application = z.infer<typeof ApplicationSchema>;
export type RenewalTracker = z.infer<typeof RenewalTrackerSchema>;

export function autoFillApplication(
  patientData: { name: string; dob: string; address: string; phone: string; ssn?: string; income: number; householdSize: number; insurance: string; physician: string; physicianPhone: string; physicianNpi: string },
  medication: { name: string; dosage: string; ndc?: string; diagnosis: string },
  programId: string,
  programName: string,
): Application {
  const fields: Application['fields'] = [
    { fieldName: 'Patient Name', fieldType: 'text', value: patientData.name, required: true, autoFilled: true },
    { fieldName: 'Date of Birth', fieldType: 'date', value: patientData.dob, required: true, autoFilled: true },
    { fieldName: 'Address', fieldType: 'text', value: patientData.address, required: true, autoFilled: true },
    { fieldName: 'Phone', fieldType: 'text', value: patientData.phone, required: true, autoFilled: true },
    { fieldName: 'Annual Household Income', fieldType: 'number', value: patientData.income.toString(), required: true, autoFilled: true },
    { fieldName: 'Household Size', fieldType: 'number', value: patientData.householdSize.toString(), required: true, autoFilled: true },
    { fieldName: 'Insurance Status', fieldType: 'text', value: patientData.insurance, required: true, autoFilled: true },
    { fieldName: 'Medication Name', fieldType: 'text', value: medication.name, required: true, autoFilled: true },
    { fieldName: 'Medication Dosage', fieldType: 'text', value: medication.dosage, required: true, autoFilled: true },
    { fieldName: 'Diagnosis', fieldType: 'text', value: medication.diagnosis, required: true, autoFilled: true },
    { fieldName: 'Prescribing Physician', fieldType: 'text', value: patientData.physician, required: true, autoFilled: true },
    { fieldName: 'Physician Phone', fieldType: 'text', value: patientData.physicianPhone, required: true, autoFilled: true },
    { fieldName: 'Physician NPI', fieldType: 'text', value: patientData.physicianNpi, required: true, autoFilled: true },
    { fieldName: 'Patient Signature', fieldType: 'signature', required: true, autoFilled: false },
    { fieldName: 'Physician Signature', fieldType: 'signature', required: true, autoFilled: false },
  ];

  return {
    id: crypto.randomUUID(), patientId: crypto.randomUUID(), programId, programName,
    medication: medication.name, status: 'draft', createdAt: new Date().toISOString(),
    fields,
    requiredDocuments: [
      { type: 'income_proof', description: 'Tax return, pay stubs, or SSI letter', attached: false },
      { type: 'prescription', description: 'Current prescription from physician', attached: false },
      { type: 'insurance_card', description: 'Copy of insurance card (front and back)', attached: false },
    ],
    physicianSignatureRequired: true,
    notes: [{ date: new Date().toISOString(), note: 'Application auto-filled from patient intake data' }],
  };
}

export function trackRenewals(applications: Application[]): RenewalTracker {
  const now = Date.now();
  const active = applications.filter(a => a.status === 'approved');
  const upcoming = active
    .filter(a => a.renewalDeadline)
    .map(a => {
      const deadline = new Date(a.renewalDeadline!).getTime();
      return {
        applicationId: a.id, programName: a.programName, medication: a.medication,
        renewalDeadline: a.renewalDeadline!, daysRemaining: Math.ceil((deadline - now) / 86400000),
        autoRenewable: false,
      };
    })
    .filter(r => r.daysRemaining > 0 && r.daysRemaining <= 90)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const expired = applications
    .filter(a => a.status === 'expired')
    .map(a => ({
      applicationId: a.id, programName: a.programName, expiredAt: a.expiresAt ?? '', reapplyUrl: undefined,
    }));

  return {
    patientId: applications[0]?.patientId ?? crypto.randomUUID(),
    activeApplications: active.length,
    upcomingRenewals: upcoming,
    expiredApplications: expired,
    monthlySavingsAtRisk: 0,
  };
}
