import { addDays, addMonths, startOfMonth } from "@/lib/dates";

/**
 * Built-in multilingual intent parser (English, Lao, Thai, Vietnamese).
 * Used when no LLM is configured; maps a request onto the same predefined
 * tools the AI assistant uses. It never invents numbers.
 */

export type Intent =
  | { intent: "summary"; tool: "get_period_summary"; input: Record<string, string>; focus: "expense" | "income" | "both" }
  | { intent: "categories"; tool: "get_spending_by_category"; input: Record<string, string> }
  | { intent: "compare"; tool: "compare_periods"; input: Record<string, string> }
  | { intent: "balances"; tool: "get_balances"; input: Record<string, string> }
  | { intent: "savings"; tool: "get_savings_progress"; input: Record<string, string> }
  | { intent: "budgets"; tool: "get_budget_status"; input: Record<string, string> }
  | { intent: "find"; tool: "find_transactions"; input: Record<string, string> }
  | { intent: "add"; tool: "prepare_transaction"; input: Record<string, string> }
  | { intent: "create_account"; tool: "prepare_account"; input: Record<string, string> }
  | { intent: "create_budget"; tool: "prepare_budget"; input: Record<string, string> }
  | { intent: "scan"; tool: "open_scanner"; input: Record<string, string> }
  | { intent: "report"; tool: "show_view"; input: Record<string, string> }
  | { intent: "help" };

const has = (s: string, words: string[]) => words.some((w) => (/^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(s) : s.includes(w)));

const W = {
  today: ["today", "ມື້ນີ້", "วันนี้", "hôm nay"],
  yesterday: ["yesterday", "ມື້ວານ", "เมื่อวาน", "hôm qua"],
  lastWeek: ["last week", "ອາທິດແລ້ວ", "ອາທິດກ່ອນ", "สัปดาห์ที่แล้ว", "อาทิตย์ที่แล้ว", "สัปดาห์ก่อน", "tuần trước"],
  week: ["this week", "week", "weekly", "ອາທິດນີ້", "ອາທິດ", "สัปดาห์นี้", "อาทิตย์นี้", "สัปดาห์", "tuần này", "tuần"],
  lastMonth: ["last month", "ເດືອນແລ້ວ", "ເດືອນກ່ອນ", "เดือนที่แล้ว", "เดือนก่อน", "tháng trước"],
  month: ["this month", "month", "monthly", "ເດືອນນີ້", "ເດືອນ", "เดือนนี้", "เดือน", "tháng này", "tháng"],
  lastYear: ["last year", "ປີກາຍ", "ປີແລ້ວ", "ปีที่แล้ว", "ปีก่อน", "năm ngoái", "năm trước"],
  year: ["this year", "year", "yearly", "annual", "ປີນີ້", "ປີ", "ปีนี้", "ปี", "năm nay", "năm"],
  spend: ["spend", "spent", "spending", "expense", "expenses", "cost", "ໃຊ້ຈ່າຍ", "ລາຍຈ່າຍ", "ຈ່າຍ", "ໃຊ້ເງິນ", "ใช้จ่าย", "ใช้เงิน", "รายจ่าย", "ค่าใช้จ่าย", "จ่าย", "chi tiêu", "đã chi", "tiêu", "chi phí"],
  income: ["income", "earn", "earned", "earning", "ລາຍຮັບ", "ລາຍໄດ້", "รายได้", "รายรับ", "thu nhập"],
  where: ["where", "most", "breakdown", "categories", "category", "ໄປໃສ", "ຫຼາຍທີ່ສຸດ", "ໝວດ", "ไปไหน", "มากที่สุด", "หมวด", "ở đâu", "đi đâu", "nhiều nhất", "danh mục"],
  compare: ["compare", "comparison", "versus", "vs", "ທຽບ", "ປຽບທຽບ", "เปรียบเทียบ", "เทียบ", "so sánh", "so với"],
  balance: ["balance", "balances", "accounts", "account", "available", "net worth", "how much do i have", "ຍອດເງິນ", "ບັນຊີ", "ເງິນຄົງເຫຼືອ", "ມີເງິນ", "ยอดเงิน", "บัญชี", "คงเหลือ", "มีเงิน", "số dư", "tài khoản", "có bao nhiêu tiền"],
  savings: ["saving", "savings", "goal", "goals", "ເງິນອອມ", "ອອມ", "ເປົ້າໝາຍ", "เงินออม", "ออม", "เป้าหมาย", "tiết kiệm", "mục tiêu"],
  add: ["add", "record", "log", "ເພີ່ມ", "ບັນທຶກ", "เพิ่ม", "บันทึก", "จด", "thêm", "ghi"],
  create: ["create", "new", "open", "make", "set", "ສ້າງ", "ເປີດ", "ໃໝ່", "ຕັ້ງ", "สร้าง", "เปิด", "ใหม่", "ตั้ง", "tạo", "mở", "mới", "đặt", "lập"],
  budget: ["budget", "budgets", "ງົບ", "ງົບປະມານ", "งบ", "งบประมาณ", "ngân sách"],
  summary: ["summary", "summarize", "summarise", "report", "overview", "ສະຫຼຸບ", "ລາຍງານ", "สรุป", "รายงาน", "tóm tắt", "báo cáo", "tổng kết"],
  above: ["above", "over", "more than", "greater than", "larger than", "bigger than", "ເກີນ", "ຫຼາຍກວ່າ", "ສູງກວ່າ", "เกิน", "มากกว่า", "สูงกว่า", "trên", "lớn hơn", "nhiều hơn", "hơn"],
  below: ["below", "under", "less than", "ໜ້ອຍກວ່າ", "ຕ່ຳກວ່າ", "น้อยกว่า", "ต่ำกว่า", "dưới", "nhỏ hơn", "ít hơn"],
  find: ["find", "search", "show transactions", "list", "ຊອກ", "ຄົ້ນຫາ", "ค้นหา", "หา", "tìm"],
  scan: ["scan", "receipt", "photo", "camera", "banknote", "ສະແກນ", "ໃບບິນ", "ໃບເສັດ", "ຖ່າຍຮູບ", "สแกน", "ใบเสร็จ", "ถ่ายรูป", "quét", "hóa đơn", "chụp"],
  banknote: ["banknote", "banknotes", "cash note", "ທະນະບັດ", "ໃບເງິນ", "ธนบัตร", "แบงก์", "tiền giấy"],
  account: ["account", "wallet", "ບັນຊີ", "ກະເປົາ", "บัญชี", "กระเป๋า", "tài khoản", "ví"],
  transfer: ["transfer", "move money", "ໂອນ", "โอน", "chuyển"],
  incomeAdd: ["income", "salary", "received", "got paid", "ລາຍຮັບ", "ເງິນເດືອນ", "ໄດ້ຮັບ", "รายได้", "เงินเดือน", "ได้รับ", "thu nhập", "lương", "nhận"],
};

const MONTHS: [number, string[]][] = [
  [1, ["january", "jan", "ມັງກອນ", "มกราคม", "tháng 1", "tháng một", "tháng giêng"]],
  [2, ["february", "feb", "ກຸມພາ", "กุมภาพันธ์", "tháng 2", "tháng hai"]],
  [3, ["march", "ມີນາ", "มีนาคม", "tháng 3", "tháng ba"]],
  [4, ["april", "apr", "ເມສາ", "เมษายน", "tháng 4", "tháng tư"]],
  [5, ["may", "ພຶດສະພາ", "พฤษภาคม", "tháng 5", "tháng năm"]],
  [6, ["june", "jun", "ມິຖຸນາ", "มิถุนายน", "tháng 6", "tháng sáu"]],
  [7, ["july", "jul", "ກໍລະກົດ", "กรกฎาคม", "tháng 7", "tháng bảy"]],
  [8, ["august", "aug", "ສິງຫາ", "สิงหาคม", "tháng 8", "tháng tám"]],
  [9, ["september", "sept", "sep", "ກັນຍາ", "กันยายน", "tháng 9", "tháng chín"]],
  [10, ["october", "oct", "ຕຸລາ", "ตุลาคม", "tháng 10", "tháng mười"]],
  [11, ["november", "nov", "ພະຈິກ", "พฤศจิกายน", "tháng 11", "tháng mười một"]],
  [12, ["december", "dec", "ທັນວາ", "ธันวาคม", "tháng 12", "tháng mười hai"]],
];

const CATEGORY_WORDS: [string, string[]][] = [
  ["food", ["lunch", "dinner", "breakfast", "food", "meal", "coffee", "restaurant", "noodle", "ອາຫານ", "ເຂົ້າ", "ກາເຟ", "ເຝີ", "อาหาร", "ข้าว", "กาแฟ", "ก๋วยเตี๋ยว", "ăn", "cơm", "cà phê", "phở", "bữa trưa", "bữa tối"]],
  ["groceries", ["grocery", "groceries", "market", "supermarket", "ຕະຫຼາດ", "ຊື້ກັບເຂົ້າ", "ตลาด", "ซูเปอร์", "đi chợ", "siêu thị"]],
  ["transport", ["taxi", "grab", "bus", "train", "tuk", "ລົດ", "ແທັກຊີ", "รถ", "แท็กซี่", "xe", "taxi"]],
  ["fuel", ["fuel", "gas", "petrol", "ນ້ຳມັນ", "น้ำมัน", "xăng"]],
  ["housing", ["rent", "ຄ່າເຊົ່າ", "ค่าเช่า", "tiền nhà", "thuê nhà"]],
  ["utilities", ["electricity", "water bill", "internet", "ຄ່າໄຟ", "ຄ່ານ້ຳ", "ຄ່າເນັດ", "ค่าไฟ", "ค่าน้ำ", "ค่าเน็ต", "tiền điện", "tiền nước", "internet"]],
  ["fitness", ["gym", "fitness", "ຍິມ", "ยิม", "phòng gym"]],
  ["entertainment", ["beer", "drink", "drinks", "bar", "movie", "ເບຍ", "ດື່ມ", "เบียร์", "ดื่ม", "หนัง", "bia", "nhậu", "phim"]],
  ["shopping", ["shopping", "clothes", "ຊື້ເຄື່ອງ", "ເສື້ອ", "ช้อปปิ้ง", "เสื้อผ้า", "mua sắm", "quần áo"]],
  ["healthcare", ["doctor", "medicine", "pharmacy", "hospital", "ຢາ", "ໂຮງໝໍ", "ยา", "โรงพยาบาล", "thuốc", "bệnh viện"]],
  ["salary", ["salary", "ເງິນເດືອນ", "เงินเดือน", "lương"]],
];

const MULT: [string[], number][] = [
  [["k", "ພັນ", "พัน", "nghìn", "ngàn", "nghin"], 1_000],
  [["m", "mil", "million", "ລ້ານ", "ล้าน", "triệu", "tr"], 1_000_000],
];

const CUR_WORDS: [string, string[]][] = [
  ["LAK", ["lak", "kip", "ກີບ", "₭", "กีบ"]],
  ["THB", ["thb", "baht", "บาท", "ບາດ", "฿"]],
  ["VND", ["vnd", "dong", "đồng", "đ", "₫", "ດົ່ງ", "ดอง"]],
  ["USD", ["usd", "dollar", "dollars", "$", "ໂດລາ", "ดอลลาร์", "đô"]],
];

/** Extract the first amount (with multiplier and currency words) from text. */
export function parseMoneyText(s: string): { amount: string; currency: string | null } | null {
  const m = s.match(/(\$)?\s*(\d[\d.,\s]*\d|\d)\s*(k|mil|million|m|ພັນ|ລ້ານ|พัน|ล้าน|nghìn|ngàn|triệu|tr)?(?![a-z])\s*([a-zA-Z₭฿₫$đĐ຀-໿฀-๿]+)?/i);
  if (!m) return null;
  let raw = m[2].replace(/\s/g, "");
  // "50.000" (vi thousands) vs "12.50" (decimal): treat dot groups of 3 as thousands separators.
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, "");
  else raw = raw.replace(/,/g, "");
  let value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const mult = (m[3] ?? "").toLowerCase();
  for (const [words, f] of MULT) if (words.includes(mult)) value *= f;
  const tail = ((m[4] ?? "") + " " + (m[1] ?? "")).toLowerCase();
  let currency: string | null = null;
  for (const [code, words] of CUR_WORDS) if (words.some((w) => tail.includes(w))) currency = code;
  return { amount: String(Math.round(value * 100) / 100), currency };
}

function periodOf(s: string, today: string): { period: string; anchor_date: string } | null {
  if (has(s, W.yesterday)) return { period: "day", anchor_date: addDays(today, -1) };
  if (has(s, W.today)) return { period: "day", anchor_date: today };
  if (has(s, W.lastWeek)) return { period: "week", anchor_date: addDays(today, -7) };
  if (has(s, W.lastMonth)) return { period: "month", anchor_date: addMonths(startOfMonth(today), -1) };
  if (has(s, W.lastYear)) return { period: "year", anchor_date: `${+today.slice(0, 4) - 1}-06-01` };
  // Named months ("September", "tháng 9", "ກັນຍາ")
  for (const [n, words] of [...MONTHS].reverse()) {
    if (words.some((w) => (/^[a-z]+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(s) : s.includes(w)))) {
      const yMatch = s.match(/\b(20\d{2})\b/);
      let y = yMatch ? +yMatch[1] : +today.slice(0, 4);
      if (!yMatch && n > +today.slice(5, 7)) y -= 1; // most recent such month
      return { period: "month", anchor_date: `${y}-${String(n).padStart(2, "0")}-01` };
    }
  }
  if (has(s, W.week)) return { period: "week", anchor_date: today };
  if (has(s, W.month)) return { period: "month", anchor_date: today };
  if (has(s, W.year)) return { period: "year", anchor_date: today };
  return null;
}

function categoryOf(s: string): string | null {
  for (const [key, words] of CATEGORY_WORDS) if (words.some((w) => (/^[a-z ]+$/.test(w) ? new RegExp(`\\b${w}\\b`).test(s) : s.includes(w)))) return key;
  return null;
}

/** Text after "for"/"ສຳລັບ"/"ค่า"/"cho" — used as a description. */
function descriptionOf(original: string): string {
  const m = original.match(/(?:\bfor\b|\bon\b|ສຳລັບ|ຄ່າ|สำหรับ|ค่า|\bcho\b|\btiền\b)\s*(.+)$/i);
  if (!m) return "";
  return m[1].replace(/(\d[\d.,\s]*)(k|m|ພັນ|ລ້ານ|พัน|ล้าน|nghìn|triệu)?\s*(lak|kip|ກີບ|thb|baht|บาท|vnd|usd|\$)?/gi, "").trim().slice(0, 80);
}

export function parseIntent(text: string, today: string): Intent {
  const s = text.toLowerCase().normalize("NFC").trim();
  const period = periodOf(s, today);
  const money = parseMoneyText(s);

  if (has(s, W.scan)) return { intent: "scan", tool: "open_scanner", input: { mode: has(s, W.banknote) ? "banknote" : "receipt" } };

  const wantsCreate = has(s, W.create) || has(s, W.add);
  if (wantsCreate && has(s, W.budget)) {
    const input: Record<string, string> = { period: has(s, W.week) ? "weekly" : has(s, W.year) ? "yearly" : has(s, ["daily", "day", "ລາຍວັນ", "รายวัน", "hằng ngày"]) ? "daily" : "monthly" };
    const cat = categoryOf(s);
    if (cat) input.category_key = cat;
    if (money) input.amount = money.amount;
    return { intent: "create_budget", tool: "prepare_budget", input };
  }
  if (has(s, W.create) && has(s, W.account) && !money) {
    // "Create a new emergency account" -> name "Emergency"
    const name = text.replace(/\b(create|new|open|make|an?|the|account|wallet)\b|ສ້າງ|ໃໝ່|ເປີດ|ບັນຊີ|สร้าง|ใหม่|เปิด|บัญชี|tạo|mới|mở|tài khoản|\bví\b/gi, "").replace(/\s+/g, " ").trim();
    const isEmergency = /emergency|ສຸກເສີນ|ฉุกเฉิน|khẩn cấp/i.test(text);
    return { intent: "create_account", tool: "prepare_account", input: { name: name ? name.charAt(0).toUpperCase() + name.slice(1) : "", type: isEmergency ? "savings" : "savings" } };
  }
  if ((has(s, W.add) || (wantsCreate && money)) && money) {
    const isIncome = has(s, W.incomeAdd);
    const isTransfer = has(s, W.transfer);
    const input: Record<string, string> = { type: isTransfer ? "transfer" : isIncome ? "income" : "expense", amount: money.amount, date: period?.period === "day" ? period.anchor_date : today };
    if (money.currency) input.currency = money.currency;
    const cat = categoryOf(s);
    if (cat && !isTransfer) input.category_key = cat;
    const d = descriptionOf(text);
    if (d) input.description = d;
    return { intent: "add", tool: "prepare_transaction", input };
  }
  if ((has(s, W.above) || has(s, W.below) || has(s, W.find)) && money) {
    const input: Record<string, string> = has(s, W.below) ? { max_amount: money.amount } : { min_amount: money.amount };
    if (period) {
      // Narrow to the period if one was mentioned.
      input.start = period.anchor_date;
    }
    return { intent: "find", tool: "find_transactions", input };
  }
  if (has(s, W.compare)) return { intent: "compare", tool: "compare_periods", input: { period: period?.period === "day" ? "day" : period?.period ?? "month", anchor_date: period?.period === "month" && period.anchor_date < startOfMonth(today) ? today : period?.anchor_date ?? today } };
  if (has(s, W.where)) return { intent: "categories", tool: "get_spending_by_category", input: period ?? { period: "month", anchor_date: today } };
  if (has(s, W.savings)) return { intent: "savings", tool: "get_savings_progress", input: {} };
  if (has(s, W.budget)) return { intent: "budgets", tool: "get_budget_status", input: {} };
  if (has(s, W.summary) && !period && has(s, ["generate", "export", "ສ້າງ", "สร้าง", "tạo", "xuất"])) return { intent: "report", tool: "show_view", input: { view: "reports" } };
  if (has(s, W.spend) || has(s, W.income) || has(s, W.summary) || (period && !has(s, W.balance))) {
    const focus = has(s, W.spend) && !has(s, W.income) ? "expense" : has(s, W.income) && !has(s, W.spend) ? "income" : "both";
    return { intent: "summary", tool: "get_period_summary", input: period ?? { period: "month", anchor_date: today }, focus };
  }
  if (has(s, W.balance)) return { intent: "balances", tool: "get_balances", input: {} };
  return { intent: "help" };
}
