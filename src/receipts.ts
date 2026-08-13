import { authFetch } from "./auth";
import { WORKERS_API } from "./config";

const api = () => WORKERS_API.replace(/\/$/, "");

export type DonationReceipt = {
  id: string;
  donor_name: string;
  amount_sats: number;
  amount_btc: string;
  amount_usd: number;
  btc_price_usd: number;
  price_source: string;
  price_at: string;
  donated_at: string;
  proposal_id: string;
  proposal_title: string;
  proposal_path: string;
  created_at: string;
};

export async function fetchMyReceipts(): Promise<DonationReceipt[]> {
  const res = await authFetch(`${api()}/receipts`);
  if (!res.ok) return [];
  const data = (await res.json()) as { receipts?: DonationReceipt[] };
  return Array.isArray(data.receipts) ? data.receipts : [];
}

export async function downloadReceiptPdf(id: string): Promise<void> {
  const res = await authFetch(`${api()}/receipts/${encodeURIComponent(id)}/pdf`);
  if (!res.ok) throw new Error("Could not download receipt.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const disp = res.headers.get("Content-Disposition") || "";
  const match = disp.match(/filename="([^"]+)"/);
  a.href = url;
  a.download = match?.[1] || `BDI-receipt-${id.slice(0, 8)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
