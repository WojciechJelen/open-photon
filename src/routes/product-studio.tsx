import { createFileRoute } from "@tanstack/react-router";

import { ProductStudio } from "#/features/productStudio/components/product-studio";
import { studioSearchSchema } from "#/features/productStudio/search";

export const Route = createFileRoute("/product-studio")({
  validateSearch: studioSearchSchema,
  head: () => ({ meta: [{ title: "Product Studio · Open Photon" }] }),
  component: ProductStudioPage,
});

function ProductStudioPage() {
  return <ProductStudio search={Route.useSearch()} />;
}
