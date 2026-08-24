/** Format sourceGeneratedAt for the footer's always-visible JST date. */
export const formatUsageDataDateJst = (sourceGeneratedAt: string | undefined): string => {
  if (!sourceGeneratedAt || Number.isNaN(Date.parse(sourceGeneratedAt))) {
    return "未取得";
  }

  try {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(sourceGeneratedAt));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : "未取得";
  } catch {
    return "未取得";
  }
};
