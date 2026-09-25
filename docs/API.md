# SiteTrack API reference

All calls go to the Apps Script Web App URL.

```http
POST {API_URL}
Content-Type: text/plain;charset=utf-8

{"action":"companyLogin","token":"<session token>","payload":{...}}
```

GET is also supported: `{API_URL}?action=me&token=…&payload={…}` (used for cheap polls).
Every response is `{success, data?, error?, meta:{requestId, action, serverTime, ms, role, companyId}}`.
Errors carry `error:{code, message}` with HTTP-style codes (400/401/403/404/409/413/500…).

**Auth levels:** `none` public · `user` any signed-in account · `staff` SuperAdmin/Admin/SubAdmin · `owner` platform admin key token.
**perm** = extra permission flag required for Sub-Admins/Admins (Super Admins bypass).

**The two sign-in doors are separate and both read YOUR company sheet:**

| Door | Page | Payload | Who gets in |
|---|---|---|---|
| `companyLogin` / `companySendOtp` | `?page=company` | `identifier` (user ID / e-mail / mobile) + `password` **or** `otp`, optional `companyId` (the `CMP-…` company code) | SuperAdmin, Admin, SubAdmin only |
| `employeeLogin` / `employeeSendOtp` | `?page=employee` | `identifier` + `password` **or** `otp`, optional `companyId` | Employee (site worker) only |

Both return `portal: "company" | "employee"` in the session payload; a credential
presented at the wrong door is refused with `403` and a pointer to the right page.
There is no generic `login` action any more — every session starts at one of these
two doors, and the platform admin door (`ownerLogin`) is separate again.


## system / public

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `ping` | `actionPing` | none | — | — |
| `health` | `actionHealth` | none | — | — |
| `registerCompany` | `actionRegisterCompany` | none | — | register |
| `signupStatus` | `actionSignupStatus` | none | — | lookup |
| `sendSignupOtp` | `actionSendSignupOtp` | none | — | otp |
| `verifyOtp` | `actionVerifyOtp` | none | — | lookup |
| `companyLogin` | `actionCompanyLogin` | none | — | login |
| `companySendOtp` | `actionCompanySendOtp` | none | — | otp |
| `employeeLogin` | `actionEmployeeLogin` | none | — | login |
| `employeeSendOtp` | `actionEmployeeSendOtp` | none | — | otp |
| `ownerLogin` | `actionOwnerLogin` | none | — | login |
| `bootstrapPlatform` | `actionBootstrapPlatform` | none | — | — |

## platform owner

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `ownerStats` | `actionOwnerStats` | owner | — | — |
| `listSignupRequests` | `actionListSignupRequests` | owner | — | — |
| `approveCompany` | `actionApproveCompany` | owner | — | — |
| `rejectCompany` | `actionRejectCompany` | owner | — | — |
| `listCompanies` | `actionListCompanies` | owner | — | — |
| `setCompanyStatus` | `actionSetCompanyStatus` | owner | — | — |
| `platformAuditLog` | `actionPlatformAuditLog` | owner | — | — |
| `installTriggers` | `actionInstallTriggers` | owner | — | — |
| `removeTriggers` | `actionRemoveTriggers` | owner | — | — |
| `setScriptProperty` | `actionSetScriptProperty` | owner | — | — |
| `listScriptProperties` | `actionListScriptProperties` | owner | — | — |

## session / profile

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `me` | `actionMe` | user | — | — |
| `logout` | `actionLogout` | user | — | — |
| `changePassword` | `actionChangePassword` | user | — | — |
| `updateMyProfile` | `actionUpdateMyProfile` | user | — | — |
| `requestDeviceChange` | `actionRequestDeviceChange` | user | — | — |
| `myNotifications` | `actionMyNotifications` | user | — | — |
| `markNotificationRead` | `actionMarkNotificationRead` | user | — | — |

## settings / company setup

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `getSettings` | `actionGetSettings` | staff | — | — |
| `saveSettings` | `actionSaveSettings` | staff | manageSettings | — |
| `completeSetupWizard` | `actionCompleteSetupWizard` | staff | — | — |
| `listHolidays` | `actionListHolidays` | user | — | — |
| `saveHoliday` | `actionSaveHoliday` | staff | manageHolidays | — |
| `deleteHoliday` | `actionDeleteHoliday` | staff | manageHolidays | — |
| `listShifts` | `actionListShifts` | user | — | — |
| `saveShift` | `actionSaveShift` | staff | manageShifts | — |
| `deleteShift` | `actionDeleteShift` | staff | manageShifts | — |

## users / employees

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `listUsers` | `actionListUsers` | user | — | — |
| `getUser` | `actionGetUser` | user | — | — |
| `createUser` | `actionCreateUser` | staff | createEmployees | — |
| `updateUser` | `actionUpdateUser` | staff | editEmployees | — |
| `setUserStatus` | `actionSetUserStatus` | staff | deactivateEmployees | — |
| `setUserPermissions` | `actionSetUserPermissions` | staff | — | — |
| `resetUserPassword` | `actionResetUserPassword` | staff | editEmployees | — |
| `listDeviceRegistry` | `actionListDeviceRegistry` | staff | editEmployees | — |
| `approveDeviceChange` | `actionApproveDeviceChange` | staff | editEmployees | — |
| `blockDevice` | `actionBlockDevice` | staff | editEmployees | — |

## projects

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `listProjects` | `actionListProjects` | user | — | — |
| `getProject` | `actionGetProject` | user | — | — |
| `createProject` | `actionCreateProject` | staff | createProjects | — |
| `updateProject` | `actionUpdateProject` | staff | editProjects | — |
| `setProjectStatus` | `actionSetProjectStatus` | staff | editProjects | — |
| `geocodeAddress` | `actionGeocodeAddress` | staff | — | — |
| `assignEmployee` | `actionAssignEmployee` | staff | createEmployees | — |
| `listAssignments` | `actionListAssignments` | user | — | — |
| `endAssignment` | `actionEndAssignment` | staff | createEmployees | — |
| `projectTeam` | `actionProjectTeam` | user | — | — |
| `projectQrCode` | `actionProjectQrCode` | staff | — | — |

## attendance

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `markAttendance` | `actionMarkAttendance` | user | — | — |
| `markOut` | `actionMarkOut` | user | — | — |
| `qrCheckin` | `actionQrCheckin` | user | — | — |
| `myAttendanceToday` | `actionMyAttendanceToday` | user | — | — |
| `listAttendance` | `actionListAttendance` | user | — | — |
| `reviewAttendance` | `actionReviewAttendance` | staff | reviewAttendance | — |
| `manualMark` | `actionManualMark` | staff | reviewAttendance | — |
| `requestRegularization` | `actionRequestRegularization` | user | — | — |
| `listRegularizations` | `actionListRegularizations` | user | — (staff: queue · worker: own) | — |
| `decideRegularization` | `actionDecideRegularization` | staff | approveRegularization | — |
| `todayDashboard` | `actionTodayDashboard` | staff | — | — |
| `liveMap` | `actionLiveMap` | staff | — | — |
| `monthlySummary` | `actionMonthlySummary` | user | — | — |
| `checkSiteWeather` | `actionCheckSiteWeather` | staff | — | — |

## leave / expense / transfer

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `requestLeave` | `actionRequestLeave` | user | — | — |
| `listLeaves` | `actionListLeaves` | user | — | — |
| `cancelLeave` | `actionCancelLeave` | user | — | — |
| `decideLeave` | `actionDecideLeave` | staff | approveLeave | — |
| `requestExpense` | `actionRequestExpense` | user | — | — |
| `listExpenses` | `actionListExpenses` | user | — | — |
| `decideExpense` | `actionDecideExpense` | staff | approveExpense | — |
| `requestTransfer` | `actionRequestTransfer` | user | — | — |
| `listTransfers` | `actionListTransfers` | user | — | — |
| `decideTransfer` | `actionDecideTransfer` | staff | approveTransfer | — |
| `approvalsQueue` | `actionApprovalsQueue` | staff | — | — |

## vendors

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `listVendors` | `actionListVendors` | staff | manageVendors | — |
| `saveVendor` | `actionSaveVendor` | staff | manageVendors | — |
| `setVendorStatus` | `actionSetVendorStatus` | staff | manageVendors | — |
| `addVendorWorkerEntry` | `actionAddVendorWorkerEntry` | user | — | — |
| `listVendorWorkers` | `actionListVendorWorkers` | user | — | — |
| `vendorManpowerReport` | `actionVendorManpowerReport` | staff | viewReports | — |

## documents

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `listDocuments` | `actionListDocuments` | user | — | — |
| `uploadDocument` | `actionUploadDocument` | user | — | — |
| `updateDocument` | `actionUpdateDocument` | staff | manageDocuments | — |
| `deleteDocument` | `actionDeleteDocument` | staff | manageDocuments | — |

## reports / payroll

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `generateReport` | `actionGenerateReport` | staff | viewReports | — |
| `exportReport` | `actionExportReport` | staff | exportReports | — |
| `generatePayrollSheet` | `actionGeneratePayrollSheet` | staff | runPayroll | — |

## files

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `getFile` | `actionGetFile` | user | — | — |

## audit

| Action | Handler | Auth | Permission | Rate bucket |
|---|---|---|---|---|
| `listAuditLog` | `actionListAuditLog` | staff | viewAuditLog | — |


Total actions: **100** — this file mirrors `ACTIONS` in `backend/04_Router.gs`;
`npm run verify` fails if the two ever disagree.
