-- AlterTable
ALTER TABLE "CustomerReminder" ADD COLUMN     "followUpDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ReminderContact" ADD COLUMN     "followUpDate" TIMESTAMP(3);
