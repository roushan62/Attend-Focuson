/**
 * ============================================================================
 *  FocusHR  —  Payslip.gs
 *  Four A4 payslip templates, PDF generation into the company Drive tree,
 *  the payslip register, employee self-service downloads and email delivery.
 * ============================================================================
 */

/** Indian number-to-words used for "amount in words" on the payslip. */
function numberToWordsIndian_(value) {
  var n = Math.floor(numVal_(value));
  if (n === 0) return 'Zero Rupees Only';
  var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  var two = function (x) {
    if (x < 20) return ones[x];
    return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
  };
  var three = function (x) {
    var out = '';
    if (x > 99) { out += ones[Math.floor(x / 100)] + ' Hundred'; x = x % 100; if (x) out += ' '; }
    if (x) out += two(x);
    return out;
  };
  var crore = Math.floor(n / 10000000); n = n % 10000000;
  var lakh = Math.floor(n / 100000); n = n % 100000;
  var thousand = Math.floor(n / 1000); n = n % 1000;
  var parts = [];
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(three(lakh) + ' Lakh');
  if (thousand) parts.push(three(thousand) + ' Thousand');
  if (n) parts.push(three(n));
  return parts.join(' ').replace(/\s+/g, ' ') + ' Rupees Only';
}

var Payslip = {

  TEMPLATES: ['CLASSIC', 'MODERN', 'COMPACT', 'MINIMAL'],

  /* ============================================================== assets = */
  buildData_: function (ctx, run, employee, item) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var company = c.company || companyRow_(ctx.companyId);
    var structure = Employees.currentStructure_(ctx, employee.employee_id);
    var earnings = [
      { label: 'Basic', amount: numVal_(item.basic) },
      { label: 'House Rent Allowance', amount: numVal_(item.hra) },
      { label: 'Dearness Allowance', amount: numVal_(item.da) },
      { label: 'Conveyance', amount: numVal_(item.conveyance) },
      { label: 'Special Allowance', amount: numVal_(item.special_allowance) },
      { label: 'Other Allowance', amount: numVal_(item.other_allowance) },
      { label: 'Overtime (' + numVal_(item.ot_hours) + ' h)', amount: round0_(numVal_(item.ot_hours) * Payroll.itemOtRate_(item)), show: numVal_(item.ot_hours) > 0 },
      { label: 'Bonus / Ex-gratia', amount: numVal_(item.bonus), show: numVal_(item.bonus) !== 0 },
      { label: 'Incentive', amount: numVal_(item.incentive), show: numVal_(item.incentive) !== 0 }
    ].filter(function (e) { return e.show !== false && (e.amount !== 0 || e.show === undefined); });

    var deductions = [
      { label: 'Provident Fund (employee)', amount: numVal_(item.pf_employee) },
      { label: 'ESIC (employee)', amount: numVal_(item.esic_employee) },
      { label: 'Professional Tax', amount: numVal_(item.pt) },
      { label: 'TDS / Income Tax', amount: numVal_(item.tds) },
      { label: 'Salary Advance Recovery', amount: numVal_(item.advance_recovery), show: numVal_(item.advance_recovery) > 0 },
      { label: 'Other Deduction', amount: numVal_(item.other_deduction), show: numVal_(item.other_deduction) > 0 }
    ].filter(function (d) { return d.show !== false && d.amount !== 0; });

    var snapshot = safeJson_(item.rates_json, {});
    var tdsDetail = null;
    if (numVal_(item.tds) > 0 && snapshot.rates) {
      tdsDetail = PayrollCalc.tds({
        tds_applicable: true, regime: txt_(snapshot.rates.tds_regime || 'NEW'),
        annual_gross: numVal_(snapshot.structure ? snapshot.structure.basic + snapshot.structure.hra + snapshot.structure.da +
          snapshot.structure.conveyance + snapshot.structure.special_allowance + snapshot.structure.other_allowance : 0) * 12,
        pf_employee_annual: numVal_(item.pf_employee) * 12,
        standard_deduction_new: snapshot.rates.standard_deduction_new,
        standard_deduction_old: snapshot.rates.standard_deduction_old,
        rebate_87a_new: snapshot.rates.rebate_87a_new,
        rebate_87a_old: snapshot.rates.rebate_87a_old,
        cess_pct: snapshot.rates.cess_pct
      });
    }

    return {
      company: {
        name: txt_(company.name), legal_name: txt_(company.legal_name || company.name),
        address: [txt_(company.address), txt_(company.city), txt_(company.state), txt_(company.pincode)].filter(function (x) { return !!x; }).join(', '),
        gstin: txt_(company.gstin), pan: txt_(company.pan), logo_file_id: txt_(company.logo_file_id),
        brand_color: txt_(company.brand_color) || '#2563eb'
      },
      employee: {
        name: txt_(employee.name), code: txt_(employee.code), designation: txt_(employee.designation),
        department: txt_(employee.department), joining_date: txt_(employee.joining_date), status: txt_(employee.status),
        work_state: txt_(employee.work_state), pan: txt_(employee.pan), pf_uan: txt_(employee.pf_uan),
        esic_ip_no: txt_(employee.esic_ip_no), bank_account: maskAccount_(employee.bank_account),
        bank_name: txt_(employee.bank_name), bank_ifsc: txt_(employee.bank_ifsc)
      },
      period: {
        month: txt_(run.month), month_label: monthLabel_(run.month), fy: txt_(run.fy),
        from: txt_(run.period_from), to: txt_(run.period_to), run_code: txt_(run.code),
        pay_date: txt_(run.paid_at) || txt_(run.approved_at) || todayIso_(),
        days_basis: txt_(run.days_basis)
      },
      attendance: {
        paid_days: numVal_(item.paid_days), lop_days: numVal_(item.lop_days),
        present_days: numVal_(item.present_days), leave_days: numVal_(item.leave_days),
        holiday_days: numVal_(item.holiday_days), weekly_off_days: numVal_(item.weekly_off_days),
        ot_hours: numVal_(item.ot_hours)
      },
      earnings: earnings,
      deductions: deductions,
      totals: {
        gross: numVal_(item.gross_earnings), deductions: numVal_(item.total_deductions),
        net: numVal_(item.net_pay), reimbursement: numVal_(item.reimbursement),
        employer_pf: numVal_(item.pf_employer), employer_esic: numVal_(item.esic_employer),
        ctc: numVal_(item.ctc_cost), pf_wage: numVal_(item.pf_wage), esic_wage: numVal_(item.esic_wage)
      },
      tds_detail: tdsDetail,
      net_in_words: numberToWordsIndian_(numVal_(item.net_pay)),
      structure_effective: structure ? txt_(structure.effective_from) : '',
      generated_at: nowIso_(),
      calc_notes: txt_(item.calc_notes)
    };
  },

  /* ============================================================ templates */
  html_: function (data, template) {
    var t = txt_(template || 'CLASSIC').toUpperCase();
    if (Payslip.TEMPLATES.indexOf(t) < 0) t = 'CLASSIC';
    var brand = data.company.brand_color || '#2563eb';
    var money = function (n) { return '₹ ' + Number(numVal_(n)).toLocaleString('en-IN'); };
    var rowsEarnings = data.earnings.map(function (e) {
      return '<tr><td class="lbl">' + escapeHtml_(e.label) + '</td><td class="amt">' + money(e.amount) + '</td></tr>';
    }).join('');
    var rowsDeductions = data.deductions.map(function (d) {
      return '<tr><td class="lbl">' + escapeHtml_(d.label) + '</td><td class="amt">' + money(d.amount) + '</td></tr>';
    }).join('');
    var emptyRows = function (filled, want) {
      var out = '';
      for (var i = filled; i < want; i++) out += '<tr><td class="lbl">&nbsp;</td><td class="amt">&nbsp;</td></tr>';
      return out;
    };
    var balance = Math.max(0, 8 - data.earnings.length);
    var balance2 = Math.max(0, 8 - data.deductions.length);
    rowsEarnings += emptyRows(data.earnings.length, 8);
    rowsDeductions += emptyRows(data.deductions.length, 8);
    void balance; void balance2;

    var logo = data.company.logo_file_id
      ? '<img class="logo" src="https://drive.google.com/thumbnail?id=' + escapeHtml_(data.company.logo_file_id) + '&sz=w200" alt="logo"/>'
      : '<div class="logo-placeholder" style="background:' + brand + '">' + escapeHtml_(data.company.name.slice(0, 2).toUpperCase()) + '</div>';

    var head = '' +
      '<div class="sheet">' +
      '<div class="topbar" style="background:' + brand + '"></div>' +
      '<div class="head">' +
      '<div class="brand">' + logo +
      '<div><div class="cname">' + escapeHtml_(data.company.name) + '</div>' +
      '<div class="caddr">' + escapeHtml_(data.company.address) + '</div>' +
      '<div class="cmeta">' + (data.company.gstin ? 'GSTIN: ' + escapeHtml_(data.company.gstin) + ' · ' : '') +
      (data.company.pan ? 'PAN: ' + escapeHtml_(data.company.pan) : '') + '</div></div></div>' +
      '<div class="title"><div class="ttl">PAYSLIP</div>' +
      '<div class="tmn">' + escapeHtml_(data.period.month_label) + '</div>' +
      '<div class="tsub">' + escapeHtml_(data.period.from) + ' to ' + escapeHtml_(data.period.to) + '</div></div>' +
      '</div>';

    var info = '' +
      '<table class="info">' +
      '<tr><td class="k">Employee name</td><td class="v">' + escapeHtml_(data.employee.name) + '</td>' +
      '<td class="k">Employee code</td><td class="v">' + escapeHtml_(data.employee.code) + '</td></tr>' +
      '<tr><td class="k">Designation</td><td class="v">' + escapeHtml_(data.employee.designation || '-') + '</td>' +
      '<td class="k">Department</td><td class="v">' + escapeHtml_(data.employee.department || '-') + '</td></tr>' +
      '<tr><td class="k">Date of joining</td><td class="v">' + escapeHtml_(fmtDateHuman_(data.employee.joining_date)) + '</td>' +
      '<td class="k">Pay date</td><td class="v">' + escapeHtml_(fmtDateHuman_(data.period.pay_date)) + '</td></tr>' +
      '<tr><td class="k">Paid days</td><td class="v">' + data.attendance.paid_days + '</td>' +
      '<td class="k">Loss of pay days</td><td class="v">' + data.attendance.lop_days + '</td></tr>' +
      '<tr><td class="k">PAN</td><td class="v">' + escapeHtml_(data.employee.pan || '-') + '</td>' +
      '<td class="k">Bank</td><td class="v">' + escapeHtml_((data.employee.bank_name || '-') + ' · ' + (data.employee.bank_account || '-')) + '</td></tr>' +
      '<tr><td class="k">PF UAN</td><td class="v">' + escapeHtml_(data.employee.pf_uan || '-') + '</td>' +
      '<td class="k">ESIC IP</td><td class="v">' + escapeHtml_(data.employee.esic_ip_no || '-') + '</td></tr>' +
      '</table>';

    var grid = '' +
      '<table class="grid">' +
      '<thead><tr><th>Earnings</th><th class="amt">Amount</th><th>Deductions</th><th class="amt">Amount</th></tr></thead>' +
      '<tbody>' +
      (function () {
        var out = '';
        var max = Math.max(data.earnings.length, data.deductions.length);
        for (var i = 0; i < max; i++) {
          var e = data.earnings[i] || { label: '', amount: '' };
          var d = data.deductions[i] || { label: '', amount: '' };
          out += '<tr><td class="lbl">' + escapeHtml_(e.label) + '</td>' +
            '<td class="amt">' + (e.label ? money(e.amount) : '') + '</td>' +
            '<td class="lbl">' + escapeHtml_(d.label) + '</td>' +
            '<td class="amt">' + (d.label ? money(d.amount) : '') + '</td></tr>';
        }
        return out;
      })() +
      '<tr class="total"><td class="lbl">Total earnings</td><td class="amt">' + money(data.totals.gross) + '</td>' +
      '<td class="lbl">Total deductions</td><td class="amt">' + money(data.totals.deductions) + '</td></tr>' +
      '</tbody></table>';

    var extras = [];
    if (data.totals.reimbursement > 0) {
      extras.push('<tr><td class="k">Reimbursements paid</td><td class="v">' + money(data.totals.reimbursement) + '</td></tr>');
    }
    extras.push('<tr><td class="k">Employer PF contribution</td><td class="v">' + money(data.totals.employer_pf) + '</td></tr>');
    if (data.totals.employer_esic > 0) extras.push('<tr><td class="k">Employer ESIC contribution</td><td class="v">' + money(data.totals.employer_esic) + '</td></tr>');
    if (data.tds_detail) {
      extras.push('<tr><td class="k">TDS working (' + escapeHtml_(data.tds_detail.regime) + ' regime)</td><td class="v">Taxable ₹' + Number(numVal_(data.tds_detail.taxable_income)).toLocaleString('en-IN') +
        ' · annual tax ₹' + Number(numVal_(data.tds_detail.annual_tax)).toLocaleString('en-IN') + ' · monthly ₹' + Number(numVal_(data.tds_detail.monthly)).toLocaleString('en-IN') + '</td></tr>');
    }

    var foot = '' +
      '<div class="netbox"><div class="netlbl">Net pay</div><div class="netamt">' + money(data.totals.net) + '</div>' +
      '<div class="networds">' + escapeHtml_(data.net_in_words) + '</div></div>' +
      '<table class="info small">' + extras.join('') + '</table>' +
      (t === 'MINIMAL' ? '' : '<div class="notes"><b>Attendance:</b> paid days ' + data.attendance.paid_days + ', loss of pay ' + data.attendance.lop_days +
        ', weekly offs ' + data.attendance.weekly_off_days + ', holidays ' + data.attendance.holiday_days +
        (data.attendance.ot_hours ? ', overtime ' + data.attendance.ot_hours + ' h' : '') + '.</div>') +
      (data.calc_notes ? '<div class="notes subtle">' + escapeHtml_(data.calc_notes) + '</div>' : '') +
      '<div class="sign"><div class="sigbox"><div class="sigline"></div>Employee signature</div>' +
      '<div class="sigbox"><div class="sigline"></div>Authorised signatory · ' + escapeHtml_(data.company.name) + '</div></div>' +
      '<div class="legal">This is a computer generated payslip and does not require a physical signature. ' +
      'Run ' + escapeHtml_(data.period.run_code) + ' · generated on ' + escapeHtml_(fmtDateHuman_(data.generated_at, 'dd MMM yyyy HH:mm')) + ' by ' + APP.name + '.</div>' +
      '</div>';

    var css = Payslip.css_(t, brand);
    return '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Payslip ' + escapeHtml_(data.employee.code) + ' ' + escapeHtml_(data.period.month_label) + '</title>' +
      '<style>' + css + '</style></head><body>' + head + info + grid + foot + '</body></html>';
  },

  css_: function (t, brand) {
    var base = '' +
      '*{box-sizing:border-box}' +
      'body{font-family:"Inter","Segoe UI",Arial,sans-serif;margin:0;background:#f1f5f9;color:#0f172a}' +
      '.sheet{width:210mm;min-height:290mm;margin:8mm auto;background:#fff;padding:10mm 12mm 12mm;position:relative;' +
      'box-shadow:0 2px 12px rgba(15,23,42,.12);font-size:11px;line-height:1.45}' +
      '.topbar{height:3mm;margin:-10mm -12mm 6mm;border-radius:0}' +
      '.head{display:flex;justify-content:space-between;align-items:flex-start;gap:8mm;border-bottom:1px solid #e2e8f0;padding-bottom:4mm;margin-bottom:4mm}' +
      '.brand{display:flex;gap:3mm;align-items:flex-start}' +
      '.logo{width:16mm;height:16mm;object-fit:contain}' +
      '.logo-placeholder{width:16mm;height:16mm;border-radius:3mm;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px}' +
      '.cname{font-size:15px;font-weight:700}' +
      '.caddr{color:#475569;font-size:10px;max-width:90mm}' +
      '.cmeta{color:#64748b;font-size:9.5px;margin-top:1mm}' +
      '.title{text-align:right}' +
      '.ttl{font-size:14px;font-weight:700;letter-spacing:2px;color:' + brand + '}' +
      '.tmn{font-weight:600;font-size:12px}' +
      '.tsub{color:#64748b;font-size:9.5px}' +
      'table{width:100%;border-collapse:collapse}' +
      '.info td{padding:1.4mm 2mm;border:1px solid #e2e8f0;vertical-align:top}' +
      '.info .k{background:#f8fafc;color:#475569;width:22%;font-size:9.5px;text-transform:uppercase;letter-spacing:.4px}' +
      '.info .v{width:28%;font-weight:500}' +
      '.info.small{margin-top:3mm;font-size:10px}' +
      '.grid{margin-top:4mm}' +
      '.grid th{background:' + brand + ';color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.6px;padding:2mm;text-align:left;border:1px solid ' + brand + '}' +
      '.grid td{border:1px solid #e2e8f0;padding:1.6mm 2mm}' +
      '.grid .lbl{color:#334155}' +
      '.grid .amt{text-align:right;font-weight:600;white-space:nowrap}' +
      '.grid tr.total td{background:#f8fafc;font-weight:700;border-top:1.4px solid ' + brand + '}' +
      '.netbox{margin-top:5mm;border:1.4px solid ' + brand + ';border-radius:2mm;padding:3mm 4mm;display:flex;align-items:baseline;gap:4mm;flex-wrap:wrap}' +
      '.netlbl{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#475569}' +
      '.netamt{font-size:20px;font-weight:700;color:' + brand + '}' +
      '.networds{font-size:10px;color:#475569;flex:1 1 100%}' +
      '.notes{margin-top:3mm;font-size:10px;color:#475569;background:#f8fafc;border-left:3px solid ' + brand + ';padding:2mm 3mm}' +
      '.notes.subtle{background:transparent;border-left:none;color:#94a3b8;font-size:9px;padding-left:0}' +
      '.sign{display:flex;justify-content:space-between;margin-top:12mm;gap:10mm}' +
      '.sigbox{text-align:center;font-size:9.5px;color:#475569;flex:1}' +
      '.sigline{border-bottom:1px solid #94a3b8;height:10mm;margin-bottom:1.5mm}' +
      '.legal{margin-top:6mm;font-size:8.5px;color:#94a3b8;border-top:1px dashed #cbd5e1;padding-top:2mm}' +
      '@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;width:auto;min-height:auto}@page{size:A4;margin:8mm}}';

    if (t === 'MODERN') {
      base += '.sheet{border-top:6mm solid ' + brand + ';padding-top:14mm}' +
        '.grid th{background:#0f172a;border-color:#0f172a}' +
        '.netbox{background:' + brand + ';border:none;color:#fff}.netamt,.netlbl{color:#fff}' +
        '.info .k{background:#eef2ff;color:#3730a3}';
    } else if (t === 'COMPACT') {
      base += '.sheet{font-size:10px;padding:8mm}' +
        '.grid td,.grid th{padding:1.1mm 1.6mm}' +
        '.head{padding-bottom:2mm;margin-bottom:3mm}' +
        '.sign{margin-top:8mm}';
    } else if (t === 'MINIMAL') {
      base += '.grid th{background:#fff;color:#0f172a;border-bottom:1.4px solid #0f172a}' +
        '.netbox{border:none;border-top:1.4px solid #0f172a;border-radius:0;padding-left:0}' +
        '.topbar{display:none}';
    }
    return base;
  },

  /* =============================================================== list == */
  out_: function (p) {
    return {
      payslip_id: p.payslip_id, code: p.code, run_id: p.run_id, employee_id: p.employee_id,
      employee_code: p.employee_code, employee_name: p.employee_name, fy: p.fy, month: p.month,
      month_label: monthLabel_(p.month), template: p.template, gross: numVal_(p.gross),
      deductions: numVal_(p.deductions), net_pay: numVal_(p.net_pay), file_id: p.file_id,
      file_name: p.file_name, generated_at: p.generated_at, emailed_at: p.emailed_at,
      viewed_at: p.viewed_at, note: p.note, has_file: !!txt_(p.file_id)
    };
  },

  list: function (ctx, payload) {
    Perm.require(ctx, 'payroll.view');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var allowed = Perm.allowedEmployeeIds(ctx);
    var rows = Db.all(c, 'Payslips', function (p) {
      if (allowed && allowed.indexOf(txt_(p.employee_id)) < 0) return false;
      if (payload.run_id && txt_(p.run_id) !== txt_(payload.run_id)) return false;
      if (payload.employee_id && txt_(p.employee_id) !== txt_(payload.employee_id)) return false;
      if (payload.month && txt_(p.month) !== txt_(payload.month)) return false;
      if (payload.fy && txt_(p.fy) !== txt_(payload.fy)) return false;
      if (payload.emailed === 'TRUE' && !txt_(p.emailed_at)) return false;
      if (payload.emailed === 'FALSE' && txt_(p.emailed_at)) return false;
      return true;
    });
    if (payload.search) rows = rows.filter(function (p) { return matchesSearch_(p, SCHEMA.Payslips.search, payload.search); });
    rows = sortRows_(rows, 'month', 'DESC');
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows.map(Payslip.out_),
      total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      totals: {
        payslips: rows.length,
        net: round0_(sum_(rows, function (p) { return p.net_pay; })),
        emailed: rows.filter(function (p) { return !!txt_(p.emailed_at); }).length,
        templates: Payslip.TEMPLATES
      }
    };
  },

  myPayslips: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    if (!ctx.employeeId) return { rows: [], total: 0, templates: Payslip.TEMPLATES };
    var items = Db.all(c, 'PayrollItems', function (i) { return txt_(i.employee_id) === ctx.employeeId; });
    var runs = {};
    Db.all(c, 'PayrollRuns').forEach(function (r) { runs[txt_(r.run_id)] = r; });
    var rows = Db.all(c, 'Payslips', function (p) {
      if (txt_(p.employee_id) !== ctx.employeeId) return false;
      if (payload.fy && txt_(p.fy) !== txt_(payload.fy)) return false;
      return true;
    }).map(function (p) {
      var out = Payslip.out_(p);
      var run = runs[txt_(p.run_id)];
      out.run_status = run ? txt_(run.status) : '';
      return out;
    });
    rows = sortRows_(rows, 'month', 'DESC');
    var pending = items.filter(function (i) {
      return (txt_(i.status) === 'APPROVED' || txt_(i.status) === 'PAID') && !txt_(i.payslip_id);
    }).map(function (i) {
      var run = runs[txt_(i.run_id)];
      return {
        item_id: i.item_id, run_id: i.run_id, month: run ? txt_(run.month) : '', month_label: run ? monthLabel_(run.month) : '',
        net_pay: numVal_(i.net_pay), status: 'GENERATING'
      };
    });
    var page = paginate_(rows, payload.page, payload.pageSize);
    return {
      rows: page.rows, total: page.total, page: page.page, pageSize: page.pageSize, totalPages: page.totalPages,
      pending: pending,
      fy: payload.fy || fyOf_(todayIso_()), fy_options: Leave.fyOptions_(),
      summary: {
        payslips: rows.length,
        net_total: round0_(sum_(rows, function (p) { return p.net_pay; })),
        latest_month: rows.length ? rows[0].month : ''
      }
    };
  },

  /* ================================================================ get == */
  get: function (ctx, payload) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var p = Db.get(c, 'Payslips', 'payslip_id', payload.payslip_id);
    var mine = txt_(p.employee_id) === txt_(ctx.employeeId);
    if (!mine) Perm.require(ctx, 'payroll.view');
    var item = Db.find(c, 'PayrollItems', 'item_id', p.payslip_id === '' ? '' : txt_(p.payslip_id)) || null;
    item = Db.findOne(c, 'PayrollItems', function (i) {
      return txt_(i.run_id) === txt_(p.run_id) && txt_(i.employee_id) === txt_(p.employee_id);
    });
    var run = Db.get(c, 'PayrollRuns', 'run_id', p.run_id);
    var employee = Db.get(c, 'Employees', 'employee_id', p.employee_id);
    if (!item) fail_('NOT_FOUND', 'The payroll row behind this payslip is missing. Please regenerate the payslip.');
    var data = Payslip.buildData_(ctx, run, employee, item);
    Db.update(c, 'Payslips', 'payslip_id', p.payslip_id, { viewed_at: p.viewed_at || nowIso_() }, { system: true });
    Audit.sensitive(ctx, 'payroll', 'payroll.payslip.get', 'Payslips', p.payslip_id, 'Viewed payslip ' + txt_(p.code) + ' of ' + txt_(employee.name));
    return {
      payslip: Payslip.out_(p),
      data: data,
      html: Payslip.html_(data, txt_(p.template)),
      templates: Payslip.TEMPLATES,
      can_email: Perm.has(ctx, 'payroll.edit'),
      can_reprint: Perm.has(ctx, 'payroll.edit')
    };
  },

  /* =========================================================== generate == */
  generateOne_: function (ctx, run, employee, item, template) {
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var data = Payslip.buildData_(ctx, run, employee, item);
    var html = Payslip.html_(data, template);
    var fileName = 'Payslip_' + txt_(employee.code) + '_' + txt_(run.month) + '.pdf';
    var file = Files.saveGenerated(ctx, {
      html: html, name: fileName, mime: 'application/pdf', folder_key: 'payslip',
      fy: txt_(run.fy), month: txt_(run.month)
    });
    var existing = Db.findOne(c, 'Payslips', function (p) {
      return txt_(p.run_id) === run.run_id && txt_(p.employee_id) === employee.employee_id;
    });
    var patch = {
      run_id: run.run_id, employee_id: employee.employee_id, employee_code: txt_(employee.code),
      employee_name: txt_(employee.name), fy: txt_(run.fy), month: txt_(run.month),
      template: txt_(template).toUpperCase(), gross: numVal_(item.gross_earnings),
      deductions: numVal_(item.total_deductions), net_pay: numVal_(item.net_pay),
      file_id: file.getId(), file_name: file.getName(), generated_at: nowIso_()
    };
    var row;
    if (existing) {
      if (existing.file_id && existing.file_id !== file.getId()) {
        try { DriveApp.getFileById(txt_(existing.file_id)).setTrashed(true); } catch (e) { /* already gone */ }
      }
      row = Db.update(c, 'Payslips', 'payslip_id', existing.payslip_id, patch, { actor: ctx.userId });
    } else {
      patch.code = Db.nextId(c, 'Payslips');
      row = Db.insert(c, 'Payslips', patch, { actor: ctx.userId });
    }
    Db.update(c, 'PayrollItems', 'item_id', item.item_id, { payslip_id: row.payslip_id }, { actor: ctx.userId });
    return { payslip: row, file_id: file.getId(), file_name: file.getName(), url: file.getUrl() };
  },

  generate: function (ctx, payload) {
    Perm.require(ctx, 'payroll.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run, employee, item;
    if (payload.payslip_id) {
      var existing = Db.get(c, 'Payslips', 'payslip_id', payload.payslip_id);
      run = Db.get(c, 'PayrollRuns', 'run_id', existing.run_id);
      employee = Db.get(c, 'Employees', 'employee_id', existing.employee_id);
      item = Db.findOne(c, 'PayrollItems', function (i) {
        return txt_(i.run_id) === run.run_id && txt_(i.employee_id) === employee.employee_id;
      });
    } else {
      run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
      employee = Db.get(c, 'Employees', 'employee_id', payload.employee_id);
      item = Db.findOne(c, 'PayrollItems', function (i) {
        return txt_(i.run_id) === run.run_id && txt_(i.employee_id) === employee.employee_id;
      });
    }
    if (!item) fail_('NOT_FOUND', 'No payroll row found for this employee in the selected run.');
    if (txt_(run.status) === 'DRAFT' || txt_(run.status) === 'PROCESSING') {
      fail_('NOT_ALLOWED', 'Payroll for ' + monthLabel_(run.month) + ' is still ' + txt_(run.status).toLowerCase() + '. Generate payslips after approval.');
    }
    var template = txt_(payload.template || getSetting_(ctx, 'payroll.payslip_template', 'CLASSIC')).toUpperCase();
    var out = Payslip.generateOne_(ctx, run, employee, item, template);
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.payslip.generate', entity: 'Payslips', entity_id: out.payslip.payslip_id,
      after: { employee: txt_(employee.name), month: run.month, template: template, file: out.file_name },
      note: 'Payslip generated for ' + txt_(employee.name) + ' (' + monthLabel_(run.month) + ')'
    });
    return { payslip: Payslip.out_(out.payslip), url: out.url, file_id: out.file_id };
  },

  bulkGenerate: function (ctx, payload) {
    Perm.require(ctx, 'payroll.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var run = Db.get(c, 'PayrollRuns', 'run_id', payload.run_id);
    if (['DRAFT', 'PROCESSING', 'CANCELLED'].indexOf(txt_(run.status)) >= 0) {
      fail_('NOT_ALLOWED', 'Payslips can be generated after the payroll is calculated (current status: ' + txt_(run.status) + ').');
    }
    var batch = intVal_(payload.batch, 25);
    var template = txt_(payload.template || getSetting_(ctx, 'payroll.payslip_template', 'CLASSIC')).toUpperCase();
    var items = Db.all(c, 'PayrollItems', function (i) {
      return txt_(i.run_id) === run.run_id && txt_(i.status) !== 'HOLD';
    });
    var todo = items.filter(function (i) { return payload.force || !txt_(i.payslip_id); });
    var slice = todo.slice(0, batch);
    var generated = 0, errors = [];
    slice.forEach(function (item) {
      try {
        var employee = Db.get(c, 'Employees', 'employee_id', item.employee_id);
        Payslip.generateOne_(ctx, run, employee, item, template);
        generated++;
      } catch (e) {
        errors.push({ employee_id: item.employee_id, name: txt_(item.employee_name), error: txt_(e.message) });
      }
    });
    var remaining = Math.max(0, todo.length - generated);
    Db.update(c, 'PayrollRuns', 'run_id', run.run_id, { payslips_generated: intVal_(run.payslips_generated, 0) + generated }, { actor: ctx.userId });
    if (generated) {
      Audit.write(ctx, {
        module: 'payroll', action: 'payroll.payslip.bulkGenerate', entity: 'PayrollRuns', entity_id: run.run_id,
        after: { generated: generated, remaining: remaining, errors: errors.length, template: template },
        note: generated + ' payslip(s) generated for ' + monthLabel_(run.month) + (remaining ? ' — ' + remaining + ' pending' : '')
      });
    }
    return {
      generated: generated, remaining: remaining, total: todo.length, errors: errors,
      template: template,
      message: remaining
        ? generated + ' payslip(s) generated, ' + remaining + ' to go — press "Continue generating" to finish them.'
        : 'All ' + generated + ' payslip(s) are ready in the company Drive folder.'
    };
  },

  email: function (ctx, payload) {
    Perm.require(ctx, 'payroll.edit');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var targets = [];
    if (payload.payslip_id) {
      targets.push(Db.get(c, 'Payslips', 'payslip_id', payload.payslip_id));
    } else if (payload.run_id) {
      targets = Db.all(c, 'Payslips', function (p) {
        return txt_(p.run_id) === txt_(payload.run_id) && (payload.employee_id ? txt_(p.employee_id) === txt_(payload.employee_id) : true);
      });
    } else if (payload.employee_id) {
      targets = Db.all(c, 'Payslips', function (p) { return txt_(p.employee_id) === txt_(payload.employee_id); });
    }
    if (!targets.length) fail_('NOT_FOUND', 'No payslips matched this request. Generate them first.');
    var employeeCache = {};
    Db.all(c, 'Employees').forEach(function (e) { employeeCache[txt_(e.employee_id)] = e; });
    var company = c.company || companyRow_(ctx.companyId);
    var sent = 0, skipped = [];
    targets.slice(0, 40).forEach(function (p) {
      var employee = employeeCache[txt_(p.employee_id)];
      var to = Email.resolve_(ctx, employee);
      if (!to) { skipped.push({ payslip_id: p.payslip_id, name: txt_(p.employee_name), reason: 'No email address on record' }); return; }
      var tpl = null;
      try { tpl = Payslip.html_(Payslip.buildData_(ctx, Db.get(c, 'PayrollRuns', 'run_id', p.run_id), employee,
        Db.findOne(c, 'PayrollItems', function (i) { return txt_(i.run_id) === p.run_id && txt_(i.employee_id) === p.employee_id; })), txt_(p.template)); }
      catch (e) { tpl = '<p>Please find your payslip attached.</p>'; }
      var attachments = [];
      if (txt_(p.file_id)) {
        try { attachments.push(DriveApp.getFileById(txt_(p.file_id)).getBlob()); } catch (e2) { /* attach skipped */ }
      }
      try {
        MailApp.sendEmail({
          to: to,
          subject: getSetting_(ctx, 'payroll.payslip_email_subject', 'Payslip for {month} - {company}')
            .split('{month}').join(monthLabel_(p.month)).split('{company}').join(txt_(company.name)),
          htmlBody: tpl,
          name: txt_(company.name),
          attachments: attachments
        });
        Db.update(c, 'Payslips', 'payslip_id', p.payslip_id, { emailed_at: nowIso_() }, { actor: ctx.userId });
        sent++;
      } catch (e3) {
        skipped.push({ payslip_id: p.payslip_id, name: txt_(p.employee_name), reason: e3.message });
      }
    });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.payslip.email', entity: 'Payslips', entity_id: '',
      after: { sent: sent, skipped: skipped.length },
      note: sent + ' payslip email(s) sent' + (skipped.length ? ', ' + skipped.length + ' skipped' : '')
    });
    return {
      sent: sent, skipped: skipped, remaining: Math.max(0, targets.length - sent - skipped.length),
      message: sent + ' payslip email(s) sent' + (skipped.length ? '. ' + skipped.length + ' could not be sent (see details).' : '.')
    };
  },

  remove: function (ctx, payload) {
    Perm.require(ctx, 'payroll.delete');
    var c = ctx.companyCtx || companyCtx_(ctx.companyId);
    var p = Db.get(c, 'Payslips', 'payslip_id', payload.payslip_id);
    if (txt_(p.file_id)) {
      try { DriveApp.getFileById(txt_(p.file_id)).setTrashed(true); } catch (e) { /* ignore */ }
    }
    Db.softDelete(c, 'Payslips', 'payslip_id', p.payslip_id, { actor: ctx.userId });
    var item = Db.findOne(c, 'PayrollItems', function (i) { return txt_(i.payslip_id) === p.payslip_id; });
    if (item) Db.update(c, 'PayrollItems', 'item_id', item.item_id, { payslip_id: '' }, { actor: ctx.userId });
    Audit.write(ctx, {
      module: 'payroll', action: 'payroll.payslip.delete', entity: 'Payslips', entity_id: p.payslip_id,
      before: Payslip.out_(p), note: 'Payslip removed (file moved to trash)', severity: 'SENSITIVE'
    });
    return { deleted: true };
  }
};
