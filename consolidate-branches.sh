#!/usr/bin/env bash
#
# ادغام شاخه‌ها به ترتیب زمانی (قدیمی -> جدید)
# نتیجه: شاخهٔ نهایی «consolidated» شامل همهٔ تغییرات، با جدیدترین در بالا.
#
# نکتهٔ مهم دربارهٔ origin/main:
#   شاخهٔ origin/main یک اسنپ‌شاتِ جداگانه با تاریخچهٔ قطع‌شده (unrelated history)
#   از همین پروژه است و ۳۷۸ فایلِ هم‌نام با بقیهٔ شاخه‌ها دارد. ادغام آن فقط
#   صدها تعارض add/add می‌سازد بدون افزودن تغییر تازه‌ای، چون دودمان اصلی
#   (subrepl-* / new / replit-agent / subrepl-uiyrwrdf) همین کد را به‌علاوهٔ
#   تغییرات جدیدتر دارد. به همین دلیل main به‌صورت پیش‌فرض رد می‌شود.
#   اگر بخواهید main هم وارد شود، متغیر INCLUDE_MAIN را روی 1 بگذارید.
#
# نحوهٔ استفاده:
#   bash consolidate-branches.sh
#   INCLUDE_MAIN=1 bash consolidate-branches.sh   # اگر اصرار به واردکردن main دارید
#
# اگر به تعارض خوردید: فایل‌ها را اصلاح کنید، سپس:
#   git add -A && git commit --no-edit
# و بقیهٔ شاخه‌ها را دستی به همان ترتیب ادغام کنید.

set -e

INCLUDE_MAIN="${INCLUDE_MAIN:-0}"

echo ">>> اگر ادغام ناتمامی در جریان است، لغوش می‌کنیم..."
git merge --abort 2>/dev/null || true

echo ">>> پاک‌کردن فایل‌های قفلِ باقی‌مانده از اجراهای قبلی..."
rm -f .git/refs/remotes/origin/HEAD.lock 2>/dev/null || true
rm -f .git/index.lock 2>/dev/null || true

echo ">>> دریافت آخرین تغییرات از ریموت..."
git fetch origin

# قدیمی‌ترین شاخه = پایه
BASE="origin/subrepl-b51cc3cu"

# ترتیب زمانی شاخه‌ها (به جز main که جدا بررسی می‌شود)
ORDER=(
  "origin/subrepl-35kq95o1"   # 2026-06-29 15:21
  "origin/subrepl-nxgt89ao"   # 2026-06-29 15:23
  "origin/subrepl-097cbtlz"   # 2026-06-29 15:24
  "origin/subrepl-f8nx5t6f"   # 2026-06-29 15:54
  # origin/main               # 2026-06-29 20:25  -> به‌صورت پیش‌فرض رد می‌شود (پایین را ببینید)
  "origin/new"                # 2026-06-29 23:00
  "origin/replit-agent"       # 2026-06-29 23:00
  "origin/subrepl-uiyrwrdf"   # 2026-06-30 16:22 (جدیدترین)
)

echo ">>> ساخت/بازنشانی شاخهٔ consolidated از پایه: $BASE"
git checkout -B consolidated "$BASE"

# ادغام زنجیره‌ای دودمان اصلی
for BRANCH in "${ORDER[@]}"; do
  echo ">>> در حال ادغام: $BRANCH"
  git merge --no-edit "$BRANCH"
done

# واردکردن اختیاری main (تاریخچهٔ جدا) — فقط در صورت درخواست صریح
if [ "$INCLUDE_MAIN" = "1" ]; then
  echo ">>> (اختیاری) ادغام origin/main با تاریخچهٔ جدا و ترجیح نسخهٔ موجود..."
  echo "    توجه: ممکن است تعارض‌های زیادی پیش بیاید."
  git merge --no-edit --allow-unrelated-histories -X ours origin/main
fi

echo ""
echo ">>> انجام شد. شاخهٔ نهایی: consolidated"
echo ">>> برای فرستادن به گیت‌هاب:"
echo "    git push origin consolidated"
