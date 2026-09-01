import HomeClient from "./home-client";
import { requirePageRole } from "@/lib/access-control";
import { getLocale } from "@/lib/i18n-server";

type HomePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  await requirePageRole("admin", "/");
  const params = await searchParams;
  const rawView = params.view;
  const view =
    (Array.isArray(rawView) ? rawView[0] : rawView) === "published" ? "published" : "active";

  return <HomeClient view={view} locale={await getLocale()} />;
}
