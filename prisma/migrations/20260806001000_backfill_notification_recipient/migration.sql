-- Backfill: existing approval RESULT notifications ("Request Approved" /
-- "Request Rejected") were created branch-wide (recipientId NULL), so every user
-- saw other people's personal results. Retarget each to the user who raised the
-- request, matched via the approval id embedded in actionUrl
-- (/admin/approvals/detail?id=<approvalRequestId>).
--
-- Only touches result rows: "Approval Required" REQUEST notifications stay
-- branch-wide (NULL) because approvers still need to see them.
UPDATE "Notification" n
SET "recipientId" = ar."requestedById"
FROM "ApprovalRequest" ar
WHERE n."recipientId" IS NULL
  AND n."type" = 'APPROVAL'
  AND n."title" IN ('Request Approved', 'Request Rejected')
  AND n."actionUrl" LIKE '%id=' || ar."id";
