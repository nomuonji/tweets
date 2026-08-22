import { getAccounts } from "@/lib/services/firestore.server";
import { ProductPoolManager } from "@/components/product-pool-manager";

export default async function ProductsPage() {
  const accounts = await getAccounts();
  return <ProductPoolManager accounts={accounts.map(({ id, handle, display_name }) => ({ id, handle, display_name }))} />;
}
