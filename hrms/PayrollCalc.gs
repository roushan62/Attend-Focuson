/**
 * ============================================================================
 *  FocusHR  —  PayrollCalc.gs
 *  PURE salary maths — no spreadsheet, no Drive, no session. Every function
 *  takes numbers in and returns numbers out, which makes the rules testable
 *  and auditable. Payroll.gs feeds it, runPayrollSelfTest() checks it.
 *
 *  Statutory basis (simplified but honest):
 *   • PF  — 12% of Basic + DA, capped at the PF wage ceiling (₹15,000 default)
 *           unless the employee is marked "FULL" (no ceiling).
 *   • ESIC — 0.75% employee / 3.25% employer when monthly gross is at or below
 *            the ESIC ceiling (₹21,000 default).
 *   • PT  — monthly state slabs (see PT_SLABS in Config.gs).
 *   • TDS — projected annual tax with the new or old regime slabs, standard
 *           deduction, section 87A rebate and 4% cess, divided by 12.
 * ============================================================================
 */

var PayrollCalc = {

  /* ================================================================ slabs */
  TDS_SLABS: {
    NEW: [{ upto: 400000, rate: 0 }, { upto: 800000, rate: 5 }, { upto: 1200000, rate: 10 }, { upto: 1600000, rate: 15 },
      { upto: 2000000, rate: 20 }, { upto: 2400000, rate: 25 }, { upto: null, rate: 30 }],
    OLD: [{ upto: 250000, rate: 0 }, { upto: 500000, rate: 5 }, { upto: 1000000, rate: 20 }, { upto: null, rate: 30 }]
  },

  /** Slab tax on an annual income for a regime. */
  slabTax: function (annualIncome, regime) {
    var slabs = PayrollCalc.TDS_SLABS[txt_(regime).toUpperCase() === 'OLD' ? 'OLD' : 'NEW'];
    var tax = 0, lower = 0;
    for (var i = 0; i < slabs.length; i++) {
      var s = slabs[i];
      var upper = s.upto === null || s.upto === undefined ? Infinity : numVal_(s.upto);
      if (annualIncome > lower) {
        var taxable = Math.min(annualIncome, upper) - lower;
        tax += taxable * numVal_(s.rate) / 100;
      }
      lower = upper;
      if (annualIncome <= upper) break;
    }
    return round0_(tax);
  },

  /* ============================================================= statutory */
  pfWage: function (basicDa, employee, rates) {
    var wage = numVal_(basicDa);
    if (!employee || boolVal_(employee.pf_applicable) === false) return 0;
    var opt = txt_(employee.pf_ceiling_opt).toUpperCase();
    var applyCeiling = rates.pf_ceiling_enabled !== false && opt !== 'FULL' && opt !== 'NO_CEILING';
    if (applyCeiling && numVal_(rates.pf_wage_ceiling) > 0 && wage > numVal_(rates.pf_wage_ceiling)) wage = numVal_(rates.pf_wage_ceiling);
    return round2_(wage);
  },

  pf: function (basicDa, employee, rates) {
    var wage = PayrollCalc.pfWage(basicDa, employee, rates);
    var pctEmployee = numVal_(employee && employee.pf_employee_pct, rates.pf_employee_pct);
    var pctEmployer = numVal_(employee && employee.pf_employer_pct, rates.pf_employer_pct);
    var pfEmployee = round0_(wage * pctEmployee / 100);
    var pfEmployer = round0_(wage * pctEmployer / 100);
    // statutory minimum of ₹1,800/month each when PF applies on a full month
    return { wage: wage, employee: pfEmployee, employer: pfEmployer, employee_pct: pctEmployee, employer_pct: pctEmployer };
  },

  esic: function (grossMonthly, employee, rates) {
    if (!employee || boolVal_(employee.esic_applicable) === false) return { applicable: false, wage: 0, employee: 0, employer: 0 };
    var ceiling = numVal_(rates.esic_wage_ceiling, 21000);
    if (ceiling > 0 && numVal_(grossMonthly) > ceiling) return { applicable: false, wage: 0, employee: 0, employer: 0 };
    var pctEmployee = numVal_(employee.esic_employee_pct, rates.esic_employee_pct);
    var pctEmployer = numVal_(employee.esic_employer_pct, rates.esic_employer_pct);
    var base = round2_(grossMonthly);
    return {
      applicable: true, wage: base,
      employee: Math.ceil(base * pctEmployee / 100),
      employer: Math.ceil(base * pctEmployer / 100),
      employee_pct: pctEmployee, employer_pct: pctEmployer
    };
  },

  professionalTax: function (grossMonthly, state, month, annualGross) {
    var slabs = PT_SLABS[state] || PT_SLABS['Maharashtra'];
    var february = txt_(month).slice(5, 7) === '02';
    if (!slabs) return { amount: 0, state: state, slab: 'none' };
    if (slabs[0] && slabs[0].annual) {
      // states such as Bihar levy an annual PT recovered over the year
      var annual = numVal_(annualGross || numVal_(grossMonthly) * 12);
      var annualAmount = 0, lowerAnnual = 0;
      slabs.forEach(function (s) {
        var upper = s.upto === null || s.upto === undefined ? Infinity : numVal_(s.upto);
        if (annual > lowerAnnual && annual <= upper) annualAmount = numVal_(s.amount);
        lowerAnnual = upper;
      });
      var monthsPaid = 12;
      return { amount: round0_(annualAmount / monthsPaid), state: state, slab: 'annual ' + annualAmount };
    }
    var amount = 0, matched = 'below exemption';
    for (var i = 0; i < slabs.length; i++) {
      var s = slabs[i];
      var upper = s.upto === null || s.upto === undefined ? Infinity : numVal_(s.upto);
      if (grossMonthly <= upper) {
        amount = february && s.feb_amount !== undefined ? numVal_(s.feb_amount) : numVal_(s.amount);
        matched = 'slab up to ' + (upper === Infinity ? 'above' : upper);
        break;
      }
    }
    return { amount: round0_(amount), state: state, slab: matched, february_adjustment: february && !!slabs.some(function (s) { return s.feb_amount !== undefined; }) };
  },

  /** Monthly TDS from a projected annual salary. */
  tds: function (opts) {
    var o = opts || {};
    if (o.tds_applicable === false) return { monthly: 0, annual_tax: 0, taxable_income: 0, regime: o.regime || 'NEW', note: 'TDS disabled for this employee' };
    var regime = txt_(o.regime || 'NEW').toUpperCase() === 'OLD' ? 'OLD' : 'NEW';
    var annualGross = numVal_(o.annual_gross);
    var standardDeduction = regime === 'NEW' ? numVal_(o.standard_deduction_new, 75000) : numVal_(o.standard_deduction_old, 50000);
    var deductions = standardDeduction + (regime === 'OLD' ? numVal_(o.pf_employee_annual, 0) : 0);
    var taxable = Math.max(0, annualGross - deductions);
    var rebateLimit = regime === 'NEW' ? numVal_(o.rebate_87a_new, 1200000) : numVal_(o.rebate_87a_old, 500000);
    var tax = PayrollCalc.slabTax(taxable, regime);
    var rebate = taxable <= rebateLimit ? tax : 0;
    var afterRebate = Math.max(0, tax - rebate);
    var cess = round0_(afterRebate * numVal_(o.cess_pct, 4) / 100);
    var annualTax = round0_(afterRebate + cess);
    return {
      monthly: round0_(annualTax / 12),
      annual_tax: annualTax,
      taxable_income: taxable,
      regime: regime,
      standard_deduction: standardDeduction,
      slab_tax: tax,
      rebate_87a: rebate,
      cess: cess,
      note: annualGross === 0 ? 'No taxable salary' : ''
    };
  },

  /* ============================================================== compute */
  /**
   * The single salary calculation used by payroll.
   * @param {object} input {employee, structure, stats, extras}
   * @param {object} rates statutory + policy settings
   * @return {object} full breakdown, all amounts rounded to whole rupees except hours
   */
  computeItem: function (input, rates) {
    var i = input || {};
    var r = rates || {};
    var employee = i.employee || {};
    var structure = i.structure || {};
    var stats = i.stats || {};
    var extras = i.extras || {};

    var basic = numVal_(structure.basic);
    var hra = numVal_(structure.hra);
    var da = numVal_(structure.da);
    var conveyance = numVal_(structure.conveyance);
    var special = numVal_(structure.special_allowance);
    var other = numVal_(structure.other_allowance);
    var grossMonthly = round2_(basic + hra + da + conveyance + special + other);

    var daysInMonth = intVal_(stats.days_in_month, daysInMonth_(i.month || todayIso_().slice(0, 7)));
    var futureDays = intVal_(stats.future_days, 0);
    var basisMode = txt_(stats.payable_days_basis || r.days_basis || 'CALENDAR').toUpperCase();
    var notEmployed = intVal_(stats.not_employed, 0);

    // payable basis: calendar days, working days, or a fixed 26 day month
    var basisDays;
    if (basisMode === 'FIXED_26') basisDays = 26;
    else if (basisMode === 'WORKING') basisDays = Math.max(1, intVal_(stats.working_days, daysInMonth) - futureDays - notEmployed);
    else basisDays = Math.max(1, daysInMonth - futureDays - notEmployed);

    var lopDays = round2_(
      numVal_(stats.absent) + numVal_(stats.unpaid_leave) + numVal_(stats.missing_punch) +
      numVal_(stats.half_day) * 0.5 + notEmployed
    );
    if (lopDays > basisDays) lopDays = basisDays;
    var paidDays = round2_(basisDays - lopDays);
    var factor = basisDays > 0 ? paidDays / basisDays : 0;

    var earnBasic = round0_(basic * factor);
    var earnHra = round0_(hra * factor);
    var earnDa = round0_(da * factor);
    var earnConveyance = round0_(conveyance * factor);
    var earnSpecial = round0_(special * factor);
    var earnOther = round0_(other * factor);

    var otRate = numVal_(structure.overtime_rate) > 0
      ? numVal_(structure.overtime_rate)
      : round0_((basic + da) / 26 / numVal_(r.work_hours_per_day, 8) * numVal_(r.ot_multiplier, 2));
    var otHours = round2_(numVal_(stats.ot_hours));
    var otAmount = round0_(otHours * otRate);

    var bonus = round0_(numVal_(extras.bonus));
    var incentive = round0_(numVal_(extras.incentive));
    var grossEarnings = round0_(earnBasic + earnHra + earnDa + earnConveyance + earnSpecial + earnOther + bonus + incentive + otAmount);

    var pf = PayrollCalc.pf(round2_((basic + da) * factor), employee, r);
    var esic = PayrollCalc.esic(grossEarnings, employee, r);
    var pt = PayrollCalc.professionalTax(grossEarnings, txt_(structure.pt_state || r.pt_state || employee.work_state || 'Maharashtra'), i.month, grossMonthly * 12);
    var tds = PayrollCalc.tds({
      tds_applicable: employee.tds_applicable === undefined ? true : boolVal_(employee.tds_applicable),
      regime: txt_(structure.tds_regime || r.tds_regime || 'NEW'),
      annual_gross: grossMonthly * 12,
      pf_employee_annual: pf.employee * 12,
      standard_deduction_new: r.standard_deduction_new,
      standard_deduction_old: r.standard_deduction_old,
      rebate_87a_new: r.rebate_87a_new,
      rebate_87a_old: r.rebate_87a_old,
      cess_pct: r.cess_pct
    });

    var reimbursement = round0_(numVal_(extras.reimbursement));
    var advance = round0_(numVal_(extras.advance_recovery));
    var otherDeduction = round0_(numVal_(extras.other_deduction));
    var totalDeductions = round0_(pf.employee + esic.employee + pt.amount + tds.monthly + advance + otherDeduction);
    var netPay = round0_(grossEarnings + reimbursement - totalDeductions);
    if (boolVal_(r.round_off) !== false) netPay = Math.round(netPay);
    if (netPay < 0) netPay = 0;
    var ctcCost = round0_(grossEarnings + pf.employer + esic.employer);

    return {
      basic: earnBasic, hra: earnHra, da: earnDa, conveyance: earnConveyance,
      special_allowance: earnSpecial, other_allowance: earnOther, bonus: bonus, incentive: incentive,
      overtime_hours: otHours, overtime_rate: otRate, overtime_amount: otAmount,
      gross_monthly: grossMonthly, gross_earnings: grossEarnings,
      present_days: round2_(numVal_(stats.present) + numVal_(stats.od)), half_days: numVal_(stats.half_day),
      paid_days: paidDays, lop_days: lopDays, basis_days: basisDays, basis_mode: basisMode,
      leave_days: numVal_(stats.paid_leave) + numVal_(stats.unpaid_leave), paid_leave_days: numVal_(stats.paid_leave),
      unpaid_leave_days: numVal_(stats.unpaid_leave), holiday_days: numVal_(stats.holiday),
      weekly_off_days: numVal_(stats.weekly_off), absent_days: numVal_(stats.absent),
      pf_wage: pf.wage, pf_employee: pf.employee, pf_employer: pf.employer,
      esic_applicable: esic.applicable, esic_wage: esic.wage, esic_employee: esic.employee, esic_employer: esic.employer,
      pt: pt.amount, pt_state: pt.state, pt_slab: pt.slab,
      tds: tds.monthly, tds_detail: tds,
      advance_recovery: advance, other_deduction: otherDeduction, reimbursement: reimbursement,
      total_deductions: totalDeductions, net_pay: netPay, ctc_cost: ctcCost,
      per_day_gross: round2_(grossMonthly / basisDays),
      calc_note: (lopDays > 0 ? lopDays + ' LOP day(s) of ' + basisDays + ' · ' : '') +
        (basisMode === 'FIXED_26' ? 'fixed 26 day month · ' : basisMode === 'WORKING' ? 'working day basis · ' : 'calendar day basis · ') +
        'OT ' + otHours + ' h @ ₹' + otRate
    };
  },

  /* ============================================================ self test */
  /**
   * Runs without touching Sheets — call it any time from the Payroll screen
   * or from the Apps Script editor (runPayrollSelfTest).
   */
  selfTest: function () {
    var baseRates = {
      pf_employee_pct: 12, pf_employer_pct: 12, pf_wage_ceiling: 15000, pf_ceiling_enabled: true,
      esic_employee_pct: 0.75, esic_employer_pct: 3.25, esic_wage_ceiling: 21000,
      pt_state: 'Delhi', tds_regime: 'NEW', standard_deduction_new: 75000, standard_deduction_old: 50000,
      rebate_87a_new: 1200000, rebate_87a_old: 500000, cess_pct: 4, ot_multiplier: 2,
      days_basis: 'CALENDAR', work_hours_per_day: 8, round_off: true
    };
    var fullMonth = {
      present: 30, half_day: 0, absent: 0, paid_leave: 0, unpaid_leave: 0, holiday: 0, weekly_off: 0,
      ot_hours: 0, days_in_month: 30, working_days: 26, future_days: 0, not_employed: 0
    };
    var emp = { name: 'Test', pf_applicable: 'TRUE', esic_applicable: 'TRUE', pt_applicable: 'TRUE', tds_applicable: 'FALSE', pf_ceiling_opt: 'CEILING' };
    var tests = [];
    var check = function (name, actual, expected) {
      var pass = Math.abs(numVal_(actual) - numVal_(expected)) < 0.51;
      tests.push({
        case: name, expected: round2_(expected), actual: round2_(actual), pass: pass,
        detail: pass ? '' : 'expected ' + expected + ', got ' + actual
      });
    };

    // 1 — plain monthly salary with no deductions enabled
    var r1 = PayrollCalc.computeItem({ employee: { pf_applicable: false, esic_applicable: false, pt_applicable: false, tds_applicable: false }, structure: { basic: 26000 }, stats: fullMonth }, baseRates);
    check('Full month, no PF/ESIC/PT/TDS → net equals gross', r1.net_pay, 26000);
    check('  … gross earnings', r1.gross_earnings, 26000);

    // 2 — PF capped at the wage ceiling
    var r2 = PayrollCalc.computeItem({ employee: emp, structure: { basic: 20000, da: 0 }, stats: fullMonth }, baseRates);
    check('PF capped at ₹15,000 ceiling → 12% = ₹1,800', r2.pf_employee, 1800);
    check('  … employer share', r2.pf_employer, 1800);

    // 3 — employee opts out of the ceiling (FULL)
    var r3 = PayrollCalc.computeItem({ employee: Object.assign({}, emp, { pf_ceiling_opt: 'FULL' }), structure: { basic: 20000 }, stats: fullMonth }, baseRates);
    check('PF without ceiling on ₹20,000 → ₹2,400', r3.pf_employee, 2400);

    // 4 — ESIC inside the ceiling
    var r4 = PayrollCalc.computeItem({ employee: emp, structure: { basic: 18000 }, stats: fullMonth }, baseRates);
    check('ESIC 0.75% on ₹18,000 → ₹135', r4.esic_employee, 135);
    check('  … ESIC employer 3.25%', r4.esic_employer, 585);

    // 5 — gross above the ESIC ceiling
    var r5 = PayrollCalc.computeItem({ employee: emp, structure: { basic: 30000 }, stats: fullMonth }, baseRates);
    check('Gross ₹30,000 is above the ESIC ceiling → no ESIC', r5.esic_employee, 0);

    // 6 — professional tax slabs (Maharashtra, ₹12,000 and February)
    var ptJan = PayrollCalc.professionalTax(12000, 'Maharashtra', '2026-01', 144000);
    var ptFeb = PayrollCalc.professionalTax(12000, 'Maharashtra', '2026-02', 144000);
    check('PT Maharashtra ₹12,000 in January → ₹200', ptJan.amount, 200);
    check('PT Maharashtra ₹12,000 in February → ₹300', ptFeb.amount, 300);

    // 7 — loss of pay: 2 absent days of a 30 day month
    var lopStats = Object.assign({}, fullMonth, { present: 28, absent: 2 });
    var r7 = PayrollCalc.computeItem({ employee: { pf_applicable: false, esic_applicable: false, pt_applicable: false, tds_applicable: false }, structure: { basic: 30000 }, stats: lopStats }, baseRates);
    check('2 LOP days of 30 → 28 payable days', r7.paid_days, 28);
    check('  … earnings prorated to ₹28,000', r7.gross_earnings, 28000);

    // 8 — half day counts as half a day of pay
    var halfStats = Object.assign({}, fullMonth, { present: 29, half_day: 1 });
    var r8 = PayrollCalc.computeItem({ employee: { pf_applicable: false, esic_applicable: false, pt_applicable: false, tds_applicable: false }, structure: { basic: 30000 }, stats: halfStats }, baseRates);
    check('One half day of 30 → 29.5 payable days', r8.paid_days, 29.5);
    check('  … earnings prorated accordingly', r8.gross_earnings, 29500);

    // 9 — TDS rebate under the new regime at ₹12,00,000
    var tds9 = PayrollCalc.tds({ annual_gross: 1200000, regime: 'NEW', tds_applicable: true, standard_deduction_new: 75000, rebate_87a_new: 1200000, cess_pct: 4, pf_employee_annual: 0 });
    check('Annual ₹12,00,000 under the new regime → zero tax (87A rebate)', tds9.annual_tax, 0);

    // 10 — TDS at a higher salary (new regime)
    var tds10 = PayrollCalc.tds({ annual_gross: 1800000, regime: 'NEW', tds_applicable: true, standard_deduction_new: 75000, rebate_87a_new: 1200000, cess_pct: 4, pf_employee_annual: 0 });
    check('Annual ₹18,00,000 new regime → ₹1,50,800 tax', tds10.annual_tax, 150800);
    check('  … monthly TDS', tds10.monthly, 12567);

    // 11 — overtime
    var otStats = Object.assign({}, fullMonth, { ot_hours: 4 });
    var r11 = PayrollCalc.computeItem({ employee: { pf_applicable: false, esic_applicable: false, pt_applicable: false, tds_applicable: false }, structure: { basic: 26000, overtime_rate: 200 }, stats: otStats }, baseRates);
    check('4 overtime hours @ ₹200 → ₹800 added', r11.gross_earnings, 26800);

    // 12 — reimbursement is added to net but never taxed
    var r12 = PayrollCalc.computeItem({
      employee: { pf_applicable: false, esic_applicable: false, pt_applicable: false, tds_applicable: false },
      structure: { basic: 26000 }, stats: fullMonth, extras: { reimbursement: 2500 }
    }, baseRates);
    check('Approved reimbursement ₹2,500 reaches net pay', r12.net_pay, 28500);
    check('  … and does not change gross earnings', r12.gross_earnings, 26000);

    // 13 — employer cost = gross + employer PF + employer ESIC (both shares are a real cost)
    var r13 = PayrollCalc.computeItem({ employee: emp, structure: { basic: 20000 }, stats: fullMonth, extras: {} }, baseRates);
    check('CTC cost = gross + employer PF + employer ESIC', r13.ctc_cost, 20000 + 1800 + 650);

    var passed = tests.filter(function (t) { return t.pass; }).length;
    return {
      ran_at: nowIso_(),
      total: tests.length,
      passed: passed,
      failed: tests.length - passed,
      ok: passed === tests.length,
      tests: tests,
      note: 'These tests run entirely inside the app. They check the salary maths, statutory caps, slabs and prorating.'
    };
  }
};

/** Convenience wrapper so the function shows up in the Apps Script editor. */
function runPayrollSelfTest() {
  var res = PayrollCalc.selfTest();
  Logger.log((res.ok ? 'ALL PASSED' : 'FAILURES: ' + res.failed) + ' (' + res.passed + '/' + res.total + ')');
  res.tests.forEach(function (t) {
    Logger.log((t.pass ? 'PASS  ' : 'FAIL  ') + t.case + (t.pass ? '' : ' — ' + t.detail));
  });
  return res;
}
