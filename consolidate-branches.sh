#!/usr/bin/env bash
#
# ادغام شاخه‌ها به ترتیب زمانی (قدیمی -> جدید)
# نتیجه: شاخهٔ نهایی «consolidated» شامل همهٔ تغییرات همهٔ شاخه‌ها،
# با آخرین تغییرات (جدیدترین شاخه) در بالا.
#
# نحوهٔ استفاده:
#   bash consolidate-branches.sh
#
# اگر در حین ادغام به تعارض (conflict) خوردید، اسکریپت متوقف می‌شود.
# آن‌وقت فایل‌های متعارض را اصلاح کنید، سپس:
#   git add -A && git commit --no-edit
# و دوباره اسکریپت را از همان شاخه ادامه دهید (دستور merge بعدی را دستی بزنید).

set -e

echo ">>> دریافت آخرین تغییرات از ریموت..."
git fetch origin

# ترتیب زمانی شاخه‌ها (قدیمی‌ترین = پایه)
BASE="origin/subrepl-b51cc3cu"
ORDER=(
  "origin/subrepl-35kq95o1"   # 2026-06-29 15:21
  "origin/subrepl-nxgt89ao"   # 2026-06-29 15:23
  "origin/subrepl-097cbtlz"   # 2026-06-29 15:24
  "origin/subrepl-f8nx5t6f"   # 2026-06-29 15:54
  "origin/main"               # 2026-06-29 20:25
  "origin/new"                # 2026-06-29 23:00
  "origin/replit-agent"       # 2026-06-29 23:00
  "origin/subrepl-uiyrwrdf"   # 2026-06-30 16:22 (جدیدترین)
)

echo ">>> ساخت شاخهٔ consolidated از پایه: $BASE"
git branch -f consolidated "$BASE"
git checkout consolidated

for BRANCH in "${ORDER[@]}"; do
  echo ">>> در حال ادغام: $BRANCH"
  # حالت پیش‌فرض: ادغام عادی؛ در صورت تعارض متوقف می‌شود تا دستی حل کنید.
  git merge --no-edit "$BRANCH"

  # --- گزینهٔ سریع (در صورت تمایل) ---
  # اگر می‌خواهید هنگام تعارض، نسخهٔ شاخهٔ جدیدتر (incoming) خودکار برنده شود،
  # خط بالا را کامنت کنید و خط زیر را فعال کنید. توجه: این کار ممکن است
  # برخی اصلاحات شاخهٔ قدیمی‌تر را در همان قطعهٔ متعارض کنار بگذارد.
  # git merge --no-edit -X theirs "$BRANCH"
done

echo ""
echo ">>> انجام شد. شاخهٔ نهایی: consolidated"
echo ">>> برای فرستادن به گیت‌هاب:"
echo "    git push origin consolidated"
