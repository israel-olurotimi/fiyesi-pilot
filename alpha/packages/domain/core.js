/* Shared pure domain functions. No storage, identity verification or bank access. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FiyesiDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const MAX_INPUT_KOBO = 5000000000;
  function checkedInteger(value, label = 'amount') {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid ' + label);
    return value;
  }
  function parseNaira(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;
    // Grouped amounts ("10,600", "₦10,600") read the same as plain digits (decision 144).
    const s = String(raw).trim().replace(/^₦\s*/, '').replace(/,(?=\d{3}(?:\D|$))/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw new TypeError('Use digits and at most two decimal places');
    const [whole, fraction = ''] = s.split('.');
    const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    checkedInteger(kobo);
    if (kobo > MAX_INPUT_KOBO) throw new RangeError('Amount exceeds ₦50,000,000');
    return kobo;
  }
  function formatKobo(kobo) {
    checkedInteger(kobo);
    return '₦' + (kobo / 100).toLocaleString('en-NG', {
      minimumFractionDigits: kobo % 100 === 0 ? 0 : 2, maximumFractionDigits: 2
    });
  }
  function lineTotal(priceKobo, quantity) {
    checkedInteger(priceKobo, 'selling price');
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError('Quantity must be positive whole base units');
    return checkedInteger(priceKobo * quantity, 'line total');
  }
  function grossProfit(priceKobo, costKobo, quantity = 1) {
    if (priceKobo === null || costKobo === null) return null;
    checkedInteger(priceKobo, 'selling price'); checkedInteger(costKobo, 'buying price');
    lineTotal(priceKobo, quantity); lineTotal(costKobo, quantity);
    const profit = (priceKobo - costKobo) * quantity;
    if (!Number.isSafeInteger(profit)) throw new RangeError('Profit overflow');
    return profit;
  }
  function cashPayment(totalKobo, tenderKobo) {
    checkedInteger(totalKobo, 'sale total');
    if (tenderKobo === null) return {totalKobo,receivedKobo:0,pendingKobo:0,unpaidKobo:totalKobo,changeKobo:0,possible:false,error:'Enter cash received'};
    checkedInteger(tenderKobo, 'cash received');
    const unpaidKobo = Math.max(0, totalKobo - tenderKobo);
    return {totalKobo,receivedKobo:Math.min(totalKobo,tenderKobo),pendingKobo:0,unpaidKobo,
      changeKobo:Math.max(0,tenderKobo-totalKobo),possible:totalKobo>0&&unpaidKobo===0,
      error:totalKobo===0?'Add an item':unpaidKobo?'Still due '+formatKobo(unpaidKobo)+'. Choose Split to combine methods.':''};
  }
  function splitPayment(totalKobo, allocations, credit = {}) {
    checkedInteger(totalKobo, 'sale total');
    let receivedKobo = 0, pendingKobo = 0;
    for (const a of allocations) {
      if (!['cash','transfer','pos'].includes(a.method)) throw new TypeError('Unknown payment method');
      checkedInteger(a.amountKobo, 'payment allocation');
      if (!['received','pending'].includes(a.status) || (a.method==='cash' && a.status!=='received')) throw new TypeError('Invalid payment status');
      if (a.status === 'received') receivedKobo += a.amountKobo;
      else pendingKobo += a.amountKobo;
      checkedInteger(receivedKobo + pendingKobo, 'payment allocation sum');
    }
    const allocatedKobo = receivedKobo + pendingKobo;
    const unpaidKobo = Math.max(0,totalKobo-allocatedKobo), excessKobo = Math.max(0,allocatedKobo-totalKobo);
    const creditAllowed = credit.allow === true && credit.role === 'owner' && typeof credit.customerName === 'string' && credit.customerName.trim().length >= 2;
    const possible = totalKobo > 0 && allocatedKobo > 0 && excessKobo === 0 && (unpaidKobo===0 || creditAllowed);
    const error = !totalKobo ? 'Add an item' : excessKobo ? 'Amounts exceed total by '+formatKobo(excessKobo)+'.'
      : unpaidKobo && !credit.allow ? formatKobo(unpaidKobo)+' left to pay.'
      : unpaidKobo && !creditAllowed ? 'A named customer and owner credit approval are required.'
      : allocatedKobo===0 ? 'Enter a payment amount' : '';
    return {totalKobo,receivedKobo,pendingKobo,unpaidKobo,allocatedKobo,excessKobo,changeKobo:0,possible,error};
  }
  function freeze(value) {
    if (value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function saleSnapshot({id,shopId,actorId,createdAt,lines,goodsState='held'}) {
    if (![id,shopId,actorId].every(x=>typeof x==='string'&&x.trim()) || !Number.isFinite(Date.parse(createdAt))) throw new TypeError('Sale identity and timestamp are required');
    if (!['held','handed-over'].includes(goodsState) || !Array.isArray(lines) || !lines.length) throw new TypeError('Sale lines and goods state are required');
    const ids = new Set();
    let totalKobo=0,knownProfitKobo=0,unknownCostLines=0;
    const snapshotLines = lines.map(l=>{
      if (!l.productId || ids.has(l.productId)) throw new TypeError('Each product needs one consolidated line');
      ids.add(l.productId);
      if (!l.name || !l.unit || l.priceKobo===null || l.priceKobo<=0) throw new TypeError('A product name, unit and selling price are required');
      const total=lineTotal(l.priceKobo,l.quantity);
      const profit=grossProfit(l.priceKobo,l.costKobo,l.quantity);
      totalKobo=checkedInteger(totalKobo+total,'sale total');
      if(profit===null)unknownCostLines++;else knownProfitKobo+=profit;
      if(!Number.isSafeInteger(knownProfitKobo))throw new RangeError('Profit overflow');
      if(l.stockCount!==null){checkedInteger(l.stockCount,'stock count');if(l.quantity>l.stockCount)throw new RangeError('Not enough counted stock');}
      else if(l.allowUnknownStock!==true)throw new TypeError('Unknown-stock policy must be explicit');
      return {productId:l.productId,name:l.name,variant:l.variant||'',unit:l.unit,quantity:l.quantity,
        sellingPriceKobo:l.priceKobo,costPriceKobo:l.costKobo,lineTotalKobo:total,grossProfitKobo:profit,
        stockBefore:l.stockCount,stockAfter:l.stockCount===null?null:l.stockCount-l.quantity};
    });
    return freeze({schemaVersion:1,id,shopId,actorId,createdAt,goodsState,lines:snapshotLines,totalKobo,knownProfitKobo,unknownCostLines,
      grossProfitKobo:unknownCostLines?null:knownProfitKobo,syncState:'not-committed'});
  }
  // One sale, several payments. Cash is entered as cash given and change is worked out after the other payments.
  // Transfer and POS are always waiting (never received) when the sale is saved. Whatever is left is owing and needs a named customer.
  function settlePayment(input) {
    const {totalKobo,payments=[],role,customerName,allowAttendantCredit=false,extraChoice=null} = input;
    checkedInteger(totalKobo, 'sale total');
    let givenKobo = 0, pendingKobo = 0;
    for (const p of payments) {
      if (!['cash','transfer','pos'].includes(p.method)) throw new TypeError('Unknown payment method');
      if (p.method === 'cash') {
        if (p.givenKobo === undefined) throw new TypeError('Enter cash given');
        checkedInteger(p.givenKobo, 'cash given'); givenKobo += p.givenKobo;
      } else {
        checkedInteger(p.amountKobo, 'payment amount');
        if (p.status !== undefined && p.status !== 'pending') throw new TypeError('A transfer or POS payment is waiting until it is confirmed');
        pendingKobo += p.amountKobo;
      }
      checkedInteger(givenKobo + pendingKobo, 'payment sum');
    }
    const neededKobo = Math.max(0, totalKobo - pendingKobo), receivedKobo = Math.min(givenKobo, neededKobo), changeKobo = givenKobo - receivedKobo;
    const extraKobo = Math.max(0, pendingKobo - totalKobo), owingKobo = Math.max(0, totalKobo - pendingKobo - receivedKobo);
    const named = typeof customerName === 'string' && customerName.trim().length >= 2, mayOwe = role === 'owner' || allowAttendantCredit === true;
    const error = !totalKobo ? 'Add an item'
      : extraKobo && !['give-back','credit'].includes(extraChoice) ? 'Choose what happens to the extra '+formatKobo(extraKobo)+'.'
      : extraKobo && extraChoice === 'credit' && !named ? 'Keeping the extra as credit needs a named customer.'
      : owingKobo && !named ? 'Owing needs a named customer.'
      : owingKobo && !mayOwe ? 'Only the owner can leave a sale owing.' : '';
    return {totalKobo,receivedKobo,pendingKobo,owingKobo,changeKobo,cashInKobo:givenKobo,cashOutKobo:changeKobo,extraKobo,extraChoice:extraKobo?extraChoice:null,
      creditKobo:extraKobo&&extraChoice==='credit'?extraKobo:0,giveBackKobo:extraKobo&&extraChoice==='give-back'?extraKobo:0,
      goodsState:pendingKobo>0?'held':'handed-over',paymentStatus:pendingKobo>0?'pending':owingKobo>0?'owing':'received',possible:error==='',error};
  }
  // A sale with several payments as rows. Cash is one received row (with change); transfer and POS are waiting rows; the rest is owing.
  // Extra money by transfer or POS is not supported yet (phase B2), so it is refused here.
  function buildSplitSale(input) {
    const r = settlePayment({...input, extraChoice: null});
    const error = r.extraKobo > 0 ? 'A transfer or POS amount is more than the sale. Lower it to the amount due.' : r.error;
    const payments = []; let cashRow = false;
    for (const p of input.payments || []) {
      if (p.method === 'cash') {
        if (!cashRow && r.cashInKobo > 0) { payments.push({method:'cash',amountKobo:r.receivedKobo,givenKobo:r.cashInKobo,changeKobo:r.changeKobo,status:'received'}); }
        cashRow = true;
      } else payments.push({method:p.method,amountKobo:p.amountKobo,status:'pending'});
    }
    return {totalKobo:r.totalKobo,receivedKobo:r.receivedKobo,pendingKobo:r.pendingKobo,owingKobo:r.owingKobo,payments,
      status:r.pendingKobo>0?'pending':r.owingKobo>0?'owing':'received',goodsState:r.pendingKobo>0?'held':'handed-over',possible:error===''&&r.totalKobo>0,error};
  }
  // Owner confirms or rejects one waiting row. Goods are released only when nothing is waiting.
  function resolvePayment(sale, paymentId, action, opts = {}) {
    const fail = error => ({ok:false,error});
    if (opts.role !== 'owner') return fail('Only the owner can do this.');
    if (!['confirm','not-received'].includes(action)) return fail('Unknown action');
    const row = (sale.payments || []).find(p => p.id === paymentId);
    if (!row) return fail('Payment not found');
    if (row.status !== 'pending' || sale.status !== 'pending') return fail('That payment is not waiting.');
    if (action === 'confirm' && opts.evidenceChecked !== true) return fail('Check your bank app or POS slip first.');
    if (action === 'not-received' && !['owing','cancel'].includes(opts.choice)) return fail('Choose what happens to the amount.');
    if (action === 'not-received' && opts.choice === 'owing' && !sale.hasCustomer) return fail('Moving it to owing needs a named customer.');
    const next = {...sale, payments: sale.payments.map(p => ({...p}))}, target = next.payments.find(p => p.id === paymentId);
    if (action === 'not-received' && opts.choice === 'cancel') {
      const refundKobo = sale.receivedKobo;
      for (const p of next.payments) if (p.status === 'pending') p.status = 'not-received';
      if (refundKobo > 0) next.payments.push({method:'cash',amountKobo:refundKobo,status:'given-back'});
      Object.assign(next, {status:'cancelled',goodsState:'not-released',receivedKobo:0,pendingKobo:0,owingKobo:0});
      return {ok:true,sale:next,releaseStock:false,refundKobo};
    }
    target.status = action === 'confirm' ? 'confirmed' : 'not-received';
    next.pendingKobo -= row.amountKobo;
    if (action === 'confirm') next.receivedKobo += row.amountKobo; else next.owingKobo += row.amountKobo;
    const release = next.pendingKobo === 0;
    if (release) { next.goodsState = 'handed-over'; next.status = next.owingKobo > 0 ? 'owing' : 'manually-reviewed'; }
    return {ok:true,sale:next,releaseStock:release,refundKobo:0};
  }
  // Decision 29 / 143: a single waiting transfer or POS payment that never arrived can move to owing instead of being
  // discarded. It needs a named customer. The customer has the goods, so stock goes down; nothing counts as received.
  function moveToOwing(sale, opts = {}) {
    const fail = error => ({ok:false,error});
    if (opts.allowed !== true) return fail('Only someone who can confirm payments can do this.');
    if (!sale || sale.status !== 'pending') return fail('That payment is not waiting.');
    if (!opts.customerId) return fail('Moving it to owing needs a named customer.');
    const pending = sale.pendingKobo ?? (sale.totalKobo - (sale.receivedKobo || 0));
    if (!Number.isSafeInteger(pending) || pending <= 0) return fail('Nothing is waiting.');
    const next = {...sale, customerId:opts.customerId, status:'owing', goodsState:'handed-over',
      pendingKobo:0, owingKobo:(sale.owingKobo || 0) + pending, receivedKobo:sale.receivedKobo || 0,
      payments:(sale.payments || []).map(p => p.status === 'pending' ? {...p, status:'not-received'} : {...p})};
    return {ok:true, sale:next, releaseStock:true, owingKobo:pending};
  }
  return Object.freeze({parseNaira,formatKobo,lineTotal,grossProfit,cashPayment,splitPayment,settlePayment,buildSplitSale,resolvePayment,moveToOwing,saleSnapshot});
});
