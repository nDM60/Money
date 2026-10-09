import type { Lang } from "../domain";

export const CATEGORY_NAMES: Record<Lang, Record<string, string>> = {
  en: {
    food: "Food & Drinks", groceries: "Groceries", transport: "Transportation", fuel: "Fuel", housing: "Housing & Rent",
    utilities: "Utilities", shopping: "Shopping", entertainment: "Entertainment", fitness: "Gym & Fitness", healthcare: "Healthcare",
    education: "Education", travel: "Travel", subscriptions: "Subscriptions", family: "Family", gifts: "Gifts",
    personal_care: "Personal Care", bills: "Bills", bank_fees: "Bank Fees", other_expense: "Other Expenses",
    salary: "Salary", bonus: "Bonus", freelance: "Freelance", business: "Business Income", interest: "Interest",
    dividends: "Dividends", investment_gains: "Investment Gains", refunds: "Refunds", other_income: "Other Income",
  },
  lo: {
    food: "ອາຫານ ແລະ ເຄື່ອງດື່ມ", groceries: "ຂອງກິນຂອງໃຊ້", transport: "ການເດີນທາງ", fuel: "ນ້ຳມັນ", housing: "ທີ່ພັກ ແລະ ຄ່າເຊົ່າ",
    utilities: "ຄ່ານ້ຳ ຄ່າໄຟ", shopping: "ຊື້ເຄື່ອງ", entertainment: "ບັນເທີງ", fitness: "ຍິມ ແລະ ອອກກຳລັງກາຍ", healthcare: "ສຸຂະພາບ",
    education: "ການສຶກສາ", travel: "ທ່ອງທ່ຽວ", subscriptions: "ຄ່າສະມາຊິກ", family: "ຄອບຄົວ", gifts: "ຂອງຂວັນ",
    personal_care: "ເບິ່ງແຍງຕົນເອງ", bills: "ໃບບິນ", bank_fees: "ຄ່າທຳນຽມທະນາຄານ", other_expense: "ລາຍຈ່າຍອື່ນໆ",
    salary: "ເງິນເດືອນ", bonus: "ເງິນໂບນັດ", freelance: "ວຽກອິດສະຫຼະ", business: "ລາຍຮັບທຸລະກິດ", interest: "ດອກເບ້ຍ",
    dividends: "ເງິນປັນຜົນ", investment_gains: "ກຳໄລການລົງທຶນ", refunds: "ເງິນຄືນ", other_income: "ລາຍຮັບອື່ນໆ",
  },
  th: {
    food: "อาหารและเครื่องดื่ม", groceries: "ของใช้ในบ้าน", transport: "การเดินทาง", fuel: "น้ำมัน", housing: "ที่พักและค่าเช่า",
    utilities: "ค่าน้ำค่าไฟ", shopping: "ช้อปปิ้ง", entertainment: "บันเทิง", fitness: "ยิมและฟิตเนส", healthcare: "สุขภาพ",
    education: "การศึกษา", travel: "ท่องเที่ยว", subscriptions: "ค่าสมาชิก", family: "ครอบครัว", gifts: "ของขวัญ",
    personal_care: "ดูแลตัวเอง", bills: "บิล", bank_fees: "ค่าธรรมเนียมธนาคาร", other_expense: "ค่าใช้จ่ายอื่นๆ",
    salary: "เงินเดือน", bonus: "โบนัส", freelance: "ฟรีแลนซ์", business: "รายได้ธุรกิจ", interest: "ดอกเบี้ย",
    dividends: "เงินปันผล", investment_gains: "กำไรจากการลงทุน", refunds: "เงินคืน", other_income: "รายได้อื่นๆ",
  },
  vi: {
    food: "Ăn uống", groceries: "Đi chợ", transport: "Di chuyển", fuel: "Xăng dầu", housing: "Nhà ở & Tiền thuê",
    utilities: "Điện nước", shopping: "Mua sắm", entertainment: "Giải trí", fitness: "Thể thao & Gym", healthcare: "Sức khỏe",
    education: "Giáo dục", travel: "Du lịch", subscriptions: "Đăng ký dịch vụ", family: "Gia đình", gifts: "Quà tặng",
    personal_care: "Chăm sóc cá nhân", bills: "Hóa đơn", bank_fees: "Phí ngân hàng", other_expense: "Chi phí khác",
    salary: "Lương", bonus: "Thưởng", freelance: "Làm tự do", business: "Thu nhập kinh doanh", interest: "Lãi tiền gửi",
    dividends: "Cổ tức", investment_gains: "Lãi đầu tư", refunds: "Hoàn tiền", other_income: "Thu nhập khác",
  },
};

/** Display name for a category: translated for default categories, as-is for custom ones. */
export function categoryLabel(c: { name: string; systemKey?: string | null }, lang: string): string {
  if (c.systemKey) {
    const en = CATEGORY_NAMES.en[c.systemKey];
    // Only translate if the user hasn't renamed it.
    const isDefaultName = Object.values(CATEGORY_NAMES).some((m) => m[c.systemKey!] === c.name);
    if (isDefaultName) return CATEGORY_NAMES[lang as Lang]?.[c.systemKey] ?? en ?? c.name;
  }
  return c.name;
}
