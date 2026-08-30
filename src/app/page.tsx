import HomeClient from "./home-client";
import { requirePageRole } from "@/lib/access-control";

type HomePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  await requirePageRole("admin", "/");
  const params = await searchParams;
  const rawView = params.view;
  const view = (Array.isArray(rawView) ? rawView[0] : rawView) === "published" ? "published" : "active";

  return <HomeClient view={view} />;
}
