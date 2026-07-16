import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;
const CURRENT_YEAR = new Date().getFullYear();
const NUMBER_PREFIXES = ['WO', 'INV', 'QUO', 'TKT'] as const;

async function main() {
  console.log('Seeding TechPotli Business OS...');

  const passwordHash = await bcrypt.hash('Admin@123', BCRYPT_ROUNDS);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@techpotli.com' },
    update: {},
    create: {
      email: 'admin@techpotli.com',
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      name: 'Super Admin',
      phone: '+919999999999',
      isActive: true,
      mustChangePassword: true,
      twoFactorEnabled: false,
      department: 'Management',
      designation: 'Super Administrator',
    },
  });

  console.log(`Super Admin created: ${superAdmin.email}`);

  await prisma.systemSettings.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      companyName: 'Techpotli E-Commerce Private Limited',
      companyAddress: 'India',
      companyGst: '',
      companyPhone: '+91 9211405666',
      companyEmail: 'support@techpotli.in',
      gstRate: 18,
      invoiceNumberPrefix: 'INV',
      workingHoursStart: '09:00',
      lateThreshold: '09:30',
      force2FA: true,
      notificationSettings: {
        emailOnLeadAssign: true,
        emailOnWorkOrder: true,
        emailOnInvoice: true,
        emailOnPayment: true,
        emailOnRenewal: true,
        emailOnLeaveRequest: true,
        emailOnExpense: true,
      },
      leaveBalances: {
        SICK: 12,
        CASUAL: 12,
        EARNED: 15,
        UNPAID: 0,
      },
      backupRetention: {
        dailyDays: 30,
        weeklyWeeks: 12,
        monthlyMonths: 12,
      },
    },
  });

  console.log('System settings created');

  const officeIps = [
    { cidr: '127.0.0.1/32', label: 'Local Dev' },
    { cidr: '152.56.178.15/32', label: 'Ravi / Remote' },
  ];

  for (const { cidr, label } of officeIps) {
    const existingIp = await prisma.allowedOfficeIp.findFirst({ where: { cidr } });
    if (!existingIp) {
      await prisma.allowedOfficeIp.create({
        data: { cidr, label, isActive: true },
      });
      console.log(`Allowed office IP ${cidr} created`);
    } else {
      console.log(`Allowed office IP ${cidr} already exists`);
    }
  }

  for (const prefix of NUMBER_PREFIXES) {
    await prisma.numberSequence.upsert({
      where: {
        prefix_year: { prefix, year: CURRENT_YEAR },
      },
      update: {},
      create: {
        prefix,
        year: CURRENT_YEAR,
        lastNumber: 0,
      },
    });
  }

  // TEPL tax invoices: FY 2026-27 starts after external invoice 112
  await prisma.numberSequence.upsert({
    where: { prefix_year: { prefix: 'TEPL', year: 2026 } },
    update: {},
    create: { prefix: 'TEPL', year: 2026, lastNumber: 112 },
  });

  console.log(`Number sequences initialized for ${CURRENT_YEAR}: ${NUMBER_PREFIXES.join(', ')}`);
  console.log('TEPL invoice sequence for FY 26-27 seeded at 112 (next = 113)');
  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
