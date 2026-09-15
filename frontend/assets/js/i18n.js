/* ============================================================================
   frontend/assets/js/i18n.js — English / हिंदी toggle (§9.10)
   The employee-facing app is fully translated; the staff web app shares the
   common chrome (navigation, statuses, buttons) and stays in English for the
   dense management screens. Add keys here and they are available everywhere.
   ========================================================================== */
window.ST = window.ST || {};

(function () {
  'use strict';

  var DICT = {
    en: {
      /* --- common chrome ------------------------------------------------ */
      appName: 'SiteTrack',
      tagline: 'Construction site live attendance & workforce management',
      signIn: 'Sign in', signOut: 'Sign out', signUp: 'Sign up', login: 'Login', logout: 'Logout',
      save: 'Save', cancel: 'Cancel', close: 'Close', submit: 'Submit', approve: 'Approve',
      reject: 'Reject', delete: 'Delete', edit: 'Edit', add: 'Add', create: 'Create',
      search: 'Search', filter: 'Filter', refresh: 'Refresh', back: 'Back', next: 'Next',
      yes: 'Yes', no: 'No', all: 'All', none: 'None', loading: 'Loading…', retry: 'Retry',
      export: 'Export', print: 'Print', download: 'Download', apply: 'Apply', reset: 'Reset',
      today: 'Today', yesterday: 'Yesterday', date: 'Date', from: 'From', to: 'To',
      month: 'Month', status: 'Status', actions: 'Actions', remarks: 'Remarks', note: 'Note',
      total: 'Total', amount: 'Amount', reason: 'Reason', type: 'Type', name: 'Name',
      mobile: 'Mobile', email: 'E-mail', project: 'Project', projects: 'Projects',
      employee: 'Employee', employees: 'Employees', vendor: 'Vendor', vendors: 'Vendors',
      settings: 'Settings', reports: 'Reports', dashboard: 'Dashboard', profile: 'Profile',
      history: 'History', notifications: 'Notifications', documents: 'Documents',
      leave: 'Leave', expense: 'Expense', transfer: 'Transfer', attendance: 'Attendance',
      approvals: 'Approvals', payroll: 'Payroll', auditLog: 'Audit log',
      required: 'This field is required', optional: 'optional',
      noData: 'Nothing to show yet', noResults: 'No records match these filters',
      offline: 'You are offline — changes are saved on this device and will sync automatically',
      onlineAgain: 'Back online — syncing your saved entries…',
      pendingSync: 'pending on this device',
      synced: 'Synced',

      /* --- attendance --------------------------------------------------- */
      markPresent: 'Mark Present', markIn: 'Check in', markOut: 'Check out',
      markedPresent: 'You are marked present', markedFlagged: 'Sent for manual approval',
      alreadyMarked: 'Already marked today', gettingGps: 'Getting your GPS location…',
      gpsDenied: 'Location permission denied. Enable it in your browser settings to mark attendance.',
      gpsTimeout: 'GPS is taking too long (common in basements). Use the QR code at the site office.',
      gpsUnavailable: 'Location is not available on this device.',
      takeSelfie: 'Take selfie', retakeSelfie: 'Retake', cameraOn: 'Camera ready — look at the lens',
      cameraDenied: 'Camera permission denied. A live selfie is required to mark attendance.',
      cameraUnsupported: 'This browser cannot open the camera. Please use Chrome on your phone.',
      distanceFromSite: 'Distance from site', insideGeofence: 'Inside the site area',
      outsideGeofence: 'Outside the site area', site: 'Site', selectSite: 'Select your site',
      qrCheckin: 'QR check-in', scanQr: 'Scan the site QR code', enterQrManually: 'Enter the code manually',
      windowClosed: 'The marking window is closed for this site', windowOpen: 'Marking window',
      saveOffline: 'Save offline', willSync: 'Saved on this device — will sync when you are online',
      regularization: 'Attendance correction', requestCorrection: 'Request a correction',
      correctionReason: 'Why does this day need correcting?',

      /* --- statuses ----------------------------------------------------- */
      Present: 'Present', Absent: 'Absent', HalfDay: 'Half day', Leave: 'On leave',
      Travel: 'Travel day', Transfer: 'Site transfer', Holiday: 'Holiday', WeekOff: 'Week off',
      Flagged: 'Flagged', Late: 'Late', NotMarked: 'Not marked',
      Pending: 'Pending', Approved: 'Approved', Rejected: 'Rejected', Cancelled: 'Cancelled',
      Active: 'Active', Inactive: 'Inactive', Suspended: 'Suspended', OnHold: 'On hold',
      Completed: 'Completed', Valid: 'Valid', ExpiringSoon: 'Expiring soon', Expired: 'Expired',
      Paid: 'Paid', Unpaid: 'Unpaid', Sick: 'Sick', Casual: 'Casual',
      AddedToSalary: 'Added to salary', PaidCash: 'Paid in cash',

      /* --- leave / expense --------------------------------------------- */
      applyLeave: 'Apply for leave', leaveType: 'Leave type', fromDate: 'From date',
      toDate: 'To date', leaveReason: 'Reason for leave', myLeaves: 'My leave requests',
      addExpense: 'Add expense', expenseCategory: 'Category', expenseDescription: 'What was this expense for?',
      uploadProof: 'Attach bill / receipt', myExpenses: 'My expense claims',
      requestTransfer: 'Request a site transfer', toProject: 'Transfer to project',
      effectiveDate: 'Effective date', travelPaid: 'Travel paid?',

      /* --- profile / home ---------------------------------------------- */
      home: 'Home', myProfile: 'My profile', subVendorLog: 'Sub-vendor log',
      logVendorWorkers: 'Log vendor workers', headcount: 'Headcount',
      welcome: 'Welcome', goodMorning: 'Good morning', goodAfternoon: 'Good afternoon', goodEvening: 'Good evening',
      todayStatus: 'Today', thisMonth: 'This month', presentDays: 'Present days',
      overtimeHours: 'Overtime hours', changePassword: 'Change password', newPassword: 'New password',
      currentPassword: 'Current password', deviceInfo: 'Device', requestDeviceChange: 'Request device change',
      installApp: 'Install app', language: 'Language',

      /* --- public pages ------------------------------------------------ */
      companySignup: 'Register your company', companyName: 'Company legal name',
      gst: 'GST / registration number', address: 'Registered address',
      contactPerson: 'Authorised person', designation: 'Designation', officialEmail: 'Official e-mail',
      industryType: 'Industry type', verifyMobile: 'Verify mobile number', sendOtp: 'Send OTP',
      otp: 'OTP', signupSubmitted: 'Your request has been submitted for review.',
      checkStatus: 'Check your application status', landingHero: 'Live, GPS-verified site attendance for construction teams',
/* --- worker app + pages (added) ------------------------------------ */
      applyExpense: 'Claim expense', applyTransfer: 'Request transfer', backHome: 'Back to home',
      bulkHeadcount: 'Bulk headcount', cameraFail: 'Camera could not start', capture: 'Capture',
      category: 'Category', checkIn: 'Check in', description: 'Description', details: 'Details',
      distance: 'Distance', docType: 'Document type', effectiveFrom: 'Effective from',
      enterId: 'Enter your mobile number or user ID', expires: 'Expires {date}', expiryDate: 'Expiry date',
      file: 'File', flagReason: 'Flag reason', gpsFail: 'GPS fix failed', gpsOk: 'GPS locked ±{acc} m',
      hello: 'Hello {name} 👋', hours: 'Hours', in: 'In', logWorkers: 'Log workers',
      lookAtCamera: 'Look straight at the camera', lopDays: 'Loss of pay', markAttendance: 'Mark attendance',
      marked: 'Marked {status}', mobileOrId: 'Mobile number / User ID', mode: 'Mode', more: 'More',
      namedWorkers: 'Named workers', noAssignment: 'You are not assigned to any active site yet.',
      noExpiry: 'No expiry', noNotifications: 'No notifications', noRequests: 'No requests yet',
      notMarked: 'Not marked', offlineHint: 'No network? Your check-in is saved on the phone and syncs automatically.',
      otHours: 'OT hours', otpCode: 'One-time code', otpLogin: 'Mobile OTP', otpSent: 'OTP sent',
      otpSentTo: 'sent via {where}', out: 'Out', outMarked: 'Checked out at {time}',
      paidDays: 'Paid days', password: 'Password', passwordChanged: 'Password changed',
      passwordLogin: 'Password', present: 'Present', proof: 'Proof photo / bill',
      qrHint: 'Scan the QR code posted at the site gate, or type the code printed under it.',
      qrScanned: 'QR code scanned', queuedOffline: 'Saved offline — will sync automatically',
      regularize: 'Request correction', requestSent: 'Request sent to your supervisor',
      requests: 'Requests', retake: 'Retake', saved: 'Saved',
      selfieOk: 'Selfie captured', selfieTitle: 'Live selfie', sending: 'Sending…',
      setNewPassword: 'Set a new password', snap: 'Snap', source: 'Source',
      startingCamera: 'Starting camera…', submitApplication: 'Submit application',
      syncDone: '{n} offline entries synced', syncing: 'Syncing your offline entries…',
      tempPassword: 'Current / temporary password', theme: 'Theme', unread: 'Unread',
      upload: 'Upload', uploadDocument: 'Upload document', uploaded: 'Document uploaded',
      vendorHistory: 'Manpower history', vendorLog: 'Vendor manpower',
      vendorNotAllowed: 'Your site role cannot log vendor workers.',
      workerLogin: 'Site staff sign-in',
      workerLoginSub: 'No password needed — sign in with your mobile number and a one-time code.',
      workerName: 'Worker name'
    },

    hi: {
      appName: 'साइटट्रैक',
      tagline: 'निर्माण साइट लाइव उपस्थिति और वर्कफोर्स प्रबंधन',
      signIn: 'साइन इन', signOut: 'साइन आउट', signUp: 'पंजीकरण', login: 'लॉगिन', logout: 'लॉगआउट',
      save: 'सहेजें', cancel: 'रद्द करें', close: 'बंद करें', submit: 'जमा करें', approve: 'स्वीकृत करें',
      reject: 'अस्वीकार करें', delete: 'हटाएँ', edit: 'बदलें', add: 'जोड़ें', create: 'बनाएँ',
      search: 'खोजें', filter: 'फ़िल्टर', refresh: 'रीफ्रेश', back: 'पीछे', next: 'आगे',
      yes: 'हाँ', no: 'नहीं', all: 'सभी', none: 'कोई नहीं', loading: 'लोड हो रहा है…', retry: 'फिर कोशिश करें',
      export: 'एक्सपोर्ट', print: 'प्रिंट', download: 'डाउनलोड', apply: 'लागू करें', reset: 'रीसेट',
      today: 'आज', yesterday: 'कल', date: 'तारीख', from: 'से', to: 'तक',
      month: 'महीना', status: 'स्थिति', actions: 'कार्रवाई', remarks: 'टिप्पणी', note: 'नोट',
      total: 'कुल', amount: 'राशि', reason: 'कारण', type: 'प्रकार', name: 'नाम',
      mobile: 'मोबाइल', email: 'ई-मेल', project: 'प्रोजेक्ट', projects: 'प्रोजेक्ट',
      employee: 'कर्मचारी', employees: 'कर्मचारी', vendor: 'वेंडर', vendors: 'वेंडर',
      settings: 'सेटिंग्स', reports: 'रिपोर्ट', dashboard: 'डैशबोर्ड', profile: 'प्रोफ़ाइल',
      history: 'इतिहास', notifications: 'सूचनाएँ', documents: 'दस्तावेज़',
      leave: 'अवकाश', expense: 'खर्च', transfer: 'स्थानांतरण', attendance: 'उपस्थिति',
      approvals: 'स्वीकृतियाँ', payroll: 'वेतन', auditLog: 'ऑडिट लॉग',
      required: 'यह जानकारी आवश्यक है', optional: 'वैकल्पिक',
      noData: 'अभी कोई जानकारी नहीं', noResults: 'इन फ़िल्टर से कोई रिकॉर्ड नहीं मिला',
      offline: 'आप ऑफ़लाइन हैं — जानकारी इसी फ़ोन में सहेजी गई है और ऑनलाइन होते ही अपने आप चली जाएगी',
      onlineAgain: 'ऑनलाइन वापस — आपकी सहेजी गई एंट्री भेजी जा रही है…',
      pendingSync: 'इस फ़ोन में बाकी',
      synced: 'सिंक हो गया',

      markPresent: 'उपस्थित मार्क करें', markIn: 'चेक इन', markOut: 'चेक आउट',
      markedPresent: 'आपकी उपस्थिति दर्ज हो गई', markedFlagged: 'मंज़ूरी के लिए भेजा गया',
      alreadyMarked: 'आज पहले ही मार्क हो चुका है', gettingGps: 'आपकी लोकेशन ली जा रही है…',
      gpsDenied: 'लोकेशन की अनुमति नहीं है। उपस्थिति दर्ज करने के लिए ब्राउज़र सेटिंग में अनुमति दें।',
      gpsTimeout: 'जीपीएस में समय लग रहा है (तहखाने में आम बात)। साइट ऑफिस में लगा क्यूआर कोड इस्तेमाल करें।',
      gpsUnavailable: 'इस फ़ोन में लोकेशन उपलब्ध नहीं है।',
      takeSelfie: 'सेल्फी लें', retakeSelfie: 'फिर से लें', cameraOn: 'कैमरा तैयार है — लेंस की तरफ देखें',
      cameraDenied: 'कैमरे की अनुमति नहीं है। उपस्थिति के लिए लाइव सेल्फी ज़रूरी है।',
      cameraUnsupported: 'यह ब्राउज़र कैमरा नहीं खोल सकता। कृपया फ़ोन में Chrome इस्तेमाल करें।',
      distanceFromSite: 'साइट से दूरी', insideGeofence: 'साइट क्षेत्र के अंदर',
      outsideGeofence: 'साइट क्षेत्र के बाहर', site: 'साइट', selectSite: 'अपनी साइट चुनें',
      qrCheckin: 'क्यूआर चेक-इन', scanQr: 'साइट का क्यूआर कोड स्कैन करें', enterQrManually: 'कोड खुद लिखें',
      windowClosed: 'इस साइट का मार्किंग समय समाप्त हो गया है', windowOpen: 'मार्किंग समय',
      saveOffline: 'ऑफ़लाइन सहेजें', willSync: 'फ़ोन में सहेजा गया — ऑनलाइन होते ही सिंक होगा',
      regularization: 'उपस्थिति सुधार', requestCorrection: 'सुधार का अनुरोध करें',
      correctionReason: 'इस दिन में सुधार क्यों चाहिए?',

      Present: 'उपस्थित', Absent: 'अनुपस्थित', HalfDay: 'आधा दिन', Leave: 'अवकाश पर',
      Travel: 'यात्रा दिवस', Transfer: 'साइट स्थानांतरण', Holiday: 'छुट्टी', WeekOff: 'साप्ताहिक अवकाश',
      Flagged: 'जाँच में', Late: 'देर से', NotMarked: 'मार्क नहीं हुआ',
      Pending: 'लंबित', Approved: 'स्वीकृत', Rejected: 'अस्वीकृत', Cancelled: 'रद्द',
      Active: 'चालू', Inactive: 'बंद', Suspended: 'निलंबित', OnHold: 'रुका हुआ',
      Completed: 'पूर्ण', Valid: 'मान्य', ExpiringSoon: 'जल्द समाप्त', Expired: 'समाप्त',
      Paid: 'सवैतनिक', Unpaid: 'बिना वेतन', Sick: 'बीमारी', Casual: 'आकस्मिक',
      AddedToSalary: 'वेतन में जुड़ा', PaidCash: 'नकद भुगतान',

      applyLeave: 'अवकाश के लिए आवेदन', leaveType: 'अवकाश प्रकार', fromDate: 'प्रारंभ तिथि',
      toDate: 'समाप्ति तिथि', leaveReason: 'अवकाश का कारण', myLeaves: 'मेरे अवकाश आवेदन',
      addExpense: 'खर्च जोड़ें', expenseCategory: 'श्रेणी', expenseDescription: 'यह खर्च किसलिए हुआ?',
      uploadProof: 'बिल / रसीद जोड़ें', myExpenses: 'मेरे खर्च दावे',
      requestTransfer: 'साइट स्थानांतरण का अनुरोध', toProject: 'किस प्रोजेक्ट में',
      effectiveDate: 'लागू तिथि', travelPaid: 'यात्रा भुगतान?',

      home: 'होम', myProfile: 'मेरी प्रोफ़ाइल', subVendorLog: 'सब-वेंडर लॉग',
      logVendorWorkers: 'वेंडर मज़दूर दर्ज करें', headcount: 'मज़दूर संख्या',
      welcome: 'स्वागत है', goodMorning: 'सुप्रभात', goodAfternoon: 'नमस्कार', goodEvening: 'शुभ संध्या',
      todayStatus: 'आज', thisMonth: 'इस महीने', presentDays: 'उपस्थित दिन',
      overtimeHours: 'ओवरटाइम घंटे', changePassword: 'पासवर्ड बदलें', newPassword: 'नया पासवर्ड',
      currentPassword: 'वर्तमान पासवर्ड', deviceInfo: 'डिवाइस', requestDeviceChange: 'डिवाइस बदलने का अनुरोध',
      installApp: 'ऐप इंस्टॉल करें', language: 'भाषा',

      companySignup: 'अपनी कंपनी पंजीकृत करें', companyName: 'कंपनी का कानूनी नाम',
      gst: 'जीएसटी / पंजीकरण संख्या', address: 'पंजीकृत पता',
      contactPerson: 'अधिकृत व्यक्ति', designation: 'पद', officialEmail: 'आधिकारिक ई-मेल',
      industryType: 'उद्योग प्रकार', verifyMobile: 'मोबाइल नंबर सत्यापित करें', sendOtp: 'ओटीपी भेजें',
      otp: 'ओटीपी', signupSubmitted: 'आपका अनुरोध समीक्षा के लिए जमा हो गया है।',
      checkStatus: 'अपने आवेदन की स्थिति देखें', landingHero: 'निर्माण टीमों के लिए लाइव, जीपीएस-सत्यापित साइट उपस्थिति',
applyExpense: 'खर्च का दावा करें', applyTransfer: 'स्थानांतरण अनुरोध', backHome: 'होम पेज पर वापस',
      bulkHeadcount: 'सामूहिक संख्या', cameraFail: 'कैमरा शुरू नहीं हो सका', capture: 'फोटो लें',
      category: 'श्रेणी', checkIn: 'चेक इन', description: 'विवरण', details: 'विवरण',
      distance: 'दूरी', docType: 'दस्तावेज़ प्रकार', effectiveFrom: 'प्रभावी तिथि',
      enterId: 'अपना मोबाइल नंबर या यूज़र आईडी दर्ज करें', expires: 'समाप्ति {date}', expiryDate: 'समाप्ति तिथि',
      file: 'फ़ाइल', flagReason: 'फ़्लैग कारण', gpsFail: 'जीपीएस नहीं मिला', gpsOk: 'जीपीएस लॉक ±{acc} मी',
      hello: 'नमस्ते {name} 👋', hours: 'घंटे', in: 'इन', logWorkers: 'मज़दूर दर्ज करें',
      lookAtCamera: 'कैमरे की ओर सीधे देखें', lopDays: 'बिना वेतन दिन', markAttendance: 'उपस्थिति दर्ज करें',
      marked: '{status} मार्क हुआ', mobileOrId: 'मोबाइल नंबर / यूज़र आईडी', mode: 'तरीका', more: 'और',
      namedWorkers: 'नाम सहित मज़दूर', noAssignment: 'आप अभी किसी सक्रिय साइट पर नियुक्त नहीं हैं।',
      noExpiry: 'कोई समाप्ति नहीं', noNotifications: 'कोई सूचना नहीं', noRequests: 'अभी कोई अनुरोध नहीं',
      notMarked: 'मार्क नहीं हुआ', offlineHint: 'नेटवर्क नहीं? आपकी चेक-इन फ़ोन में सहेजी जाएगी और अपने आप सिंक होगी।',
      otHours: 'ओवरटाइम घंटे', otpCode: 'वन-टाइम कोड', otpLogin: 'मोबाइल ओटीपी', otpSent: 'ओटीपी भेजा गया',
      otpSentTo: '{where} द्वारा भेजा', out: 'आउट', outMarked: '{time} पर चेक आउट',
      paidDays: 'वेतन योग्य दिन', password: 'पासवर्ड', passwordChanged: 'पासवर्ड बदल गया',
      passwordLogin: 'पासवर्ड', present: 'उपस्थित', proof: 'प्रमाण फोटो / बिल',
      qrHint: 'साइट गेट पर लगा क्यूआर कोड स्कैन करें, या उसके नीचे लिखा कोड टाइप करें।',
      qrScanned: 'क्यूआर कोड स्कैन हुआ', queuedOffline: 'ऑफ़लाइन सहेजा गया — अपने आप सिंक होगा',
      regularize: 'सुधार अनुरोध', requestSent: 'अनुरोध सुपरवाइज़र को भेजा गया',
      requests: 'अनुरोध', retake: 'फिर से लें', saved: 'सहेजा गया',
      selfieOk: 'सेल्फी ली गई', selfieTitle: 'लाइव सेल्फी', sending: 'भेजा जा रहा है…',
      setNewPassword: 'नया पासवर्ड सेट करें', snap: 'फोटो', source: 'स्रोत',
      startingCamera: 'कैमरा शुरू हो रहा है…', submitApplication: 'आवेदन जमा करें',
      syncDone: '{n} ऑफ़लाइन एंट्री सिंक हुई', syncing: 'ऑफ़लाइन एंट्री सिंक हो रही है…',
      tempPassword: 'वर्तमान / अस्थायी पासवर्ड', theme: 'थीम', unread: 'अपठित',
      upload: 'अपलोड', uploadDocument: 'दस्तावेज़ अपलोड करें', uploaded: 'दस्तावेज़ अपलोड हुआ',
      vendorHistory: 'मैनपॉवर इतिहास', vendorLog: 'वेंडर मैनपॉवर',
      vendorNotAllowed: 'आपकी साइट भूमिका वेंडर मज़दूर दर्ज नहीं कर सकती।',
      workerLogin: 'साइट स्टाफ साइन-इन',
      workerLoginSub: 'पासवर्ड की ज़रूरत नहीं — मोबाइल नंबर और वन-टाइम कोड से साइन इन करें।',
      workerName: 'मज़दूर का नाम'
    }
  };

  var current = ST.store ? ST.store.get('sitetrack.locale', (window.SITETRACK_CONFIG || {}).DEFAULT_LOCALE || 'en') : 'en';
  if (!DICT[current]) current = 'en';

  function t(key, vars) {
    var table = DICT[current] || DICT.en;
    var s = table[key] !== undefined ? table[key] : (DICT.en[key] !== undefined ? DICT.en[key] : key);
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
    return s;
  }

  function setLocale(locale) {
    if (!DICT[locale]) locale = 'en';
    current = locale;
    if (ST.store) ST.store.set('sitetrack.locale', locale);
    document.documentElement.lang = locale;
    document.documentElement.setAttribute('dir', 'ltr');
    apply(document.body);
    window.dispatchEvent(new CustomEvent('st:locale', { detail: { locale: locale } }));
  }

  /** Translate every [data-i18n] / [data-i18n-ph] / [data-i18n-title] node. */
  function apply(root) {
    root = root || document.body;
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n]'), function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-ph]'), function (n) {
      n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph')));
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-title]'), function (n) {
      n.setAttribute('title', t(n.getAttribute('data-i18n-title')));
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-html]'), function (n) {
      n.innerHTML = t(n.getAttribute('data-i18n-html'));
    });
  }

  /** Money / number formatting for the active locale. */
  function money(n, currency) {
    var v = Number(n || 0);
    var cur = currency || (ST.api && ST.api.session && ST.api.session.settings && ST.api.session.settings.currency) || 'INR';
    try {
      return new Intl.NumberFormat(current === 'hi' ? 'en-IN' : 'en-IN', {
        style: 'currency', currency: cur, maximumFractionDigits: 2
      }).format(v).replace('₹', '₹ ');
    } catch (e) {
      return cur + ' ' + v.toFixed(2);
    }
  }

  window.ST.i18n = {
    t: t, set: setLocale, get locale() { return current; },
    locales: [{ code: 'en', label: 'English' }, { code: 'hi', label: 'हिंदी' }],
    apply: apply, money: money, dict: DICT
  };
})();
