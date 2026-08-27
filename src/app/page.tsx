import HomeClient from "./home-client";

type HomePageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const rawView = params.view;
  const view = (Array.isArray(rawView) ? rawView[0] : rawView) === "published" ? "published" : "active";

  return <HomeClient view={view} />;
}
