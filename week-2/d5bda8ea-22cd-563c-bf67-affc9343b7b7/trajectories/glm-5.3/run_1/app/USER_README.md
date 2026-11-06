# Mela — Sign-in details

Mela seeds three demo members. All three share the password:

    deku-demo-pw-2026

| Email | Name | Role |
|---|---|---|
| host@example.com | Noor Kapoor | Host of every seeded event |
| guest@example.com | Ravi Menon | Guest (approved on Founders Board Game Night and Pottery Wheel Workshop) |
| guest2@example.com | Lena Ortiz | Guest (pending on Founders Board Game Night, approved on Pottery Wheel Workshop) |

Sign in at `/signin` with an email, then the password. Some seeded events need
approval, one is invite-only through the access code `GLOW-2026`, and hosts sign
in to manage their events at `/manage/{slug}`.
