import { getAccountsForRequest } from "@/lib/services/server-cache";
import { ProductPoolManager } from "@/components/product-pool-manager";

export default async function ProductsPage() {
  const accounts = await getAccountsForRequest();
  return <ProductPoolManager accounts={accounts.map(({ id, handle, display_name }) => ({ id, handle, display_name }))} />;
}
