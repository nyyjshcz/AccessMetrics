import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { requirePageRole } from "@/lib/access-control";
import { getLocale, getMessages } from "@/lib/i18n-server";

const members = [
  {
    id: "hong",
    photo: "/team/hong-chengze.webp",
    links: [
      { label: "Luogu", href: "https://www.luogu.com.cn/user/500596/practice" },
      { label: "GitHub", href: "https://github.com/nyyjshcz" },
    ],
  },
  {
    id: "ye",
    photo: "/team/ye-xinyi.webp",
    links: [],
  },
] as const;

function hasPhoto(photo: string) {
  return fs.existsSync(path.join(process.cwd(), "public", photo.replace(/^\//, "")));
}

export default async function TeamPage() {
  await requirePageRole("visitor", "/team");
  const locale = await getLocale();
  const copy = getMessages(locale).team;

  return (
    <section className="team-page" aria-labelledby="team-title">
      <header className="team-intro">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1 id="team-title">{copy.title}</h1>
        <p>{copy.lede}</p>
      </header>

      <div className="team-grid">
        {members.map((member) => {
          const memberCopy = copy.members[member.id];
          const photoAvailable = hasPhoto(member.photo);
          return (
            <article className="member-card" key={member.id}>
              <div className="member-photo">
                {photoAvailable ? (
                  <Image
                    src={member.photo}
                    alt={copy.photoAlt.replace("{name}", memberCopy.name)}
                    fill
                    sizes="(max-width: 680px) calc(100vw - 28px), 360px"
                  />
                ) : (
                  <div
                    className="member-photo-pending"
                    role="img"
                    aria-label={`${memberCopy.name}: ${copy.photoPending}`}
                  >
                    <span aria-hidden="true">{memberCopy.name.slice(0, 1)}</span>
                    <small>{copy.photoPending}</small>
                  </div>
                )}
              </div>

              <div className="member-body">
                <div className="member-identity">
                  <h2>{memberCopy.name}</h2>
                  <p>{memberCopy.role}</p>
                </div>

                <dl className="member-details">
                  <div>
                    <dt>{copy.school}</dt>
                    <dd>{memberCopy.school}</dd>
                  </div>
                  <div>
                    <dt>{copy.achievements}</dt>
                    <dd>
                      <ul>
                        {memberCopy.achievements.map((achievement) => (
                          <li key={achievement}>{achievement}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>

                {member.links.length > 0 && (
                  <div className="member-links">
                    <h3>{copy.links}</h3>
                    <div>
                      {member.links.map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {link.label}
                          <span aria-hidden="true">↗</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
