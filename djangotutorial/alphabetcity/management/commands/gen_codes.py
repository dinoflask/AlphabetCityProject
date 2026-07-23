"""
Generate unique resident codes, create Resident rows for them, and write the
codes to a file you can send out.

    python manage.py gen_codes                 # 1000 codes -> codes.txt
    python manage.py gen_codes 250             # 250 codes
    python manage.py gen_codes 1000 --out ~/codes.txt
    python manage.py gen_codes 1000 --file-only  # only write the file, don't touch the DB

Codes are 6 characters from an unambiguous alphabet (no 0/O/1/I/L), and are
checked against existing codes so they're globally unique. Login is
case-insensitive, so the codes are safe to print in any case.
"""
import secrets

from django.core.management.base import BaseCommand, CommandError

from alphabetcity.models import Resident

# No 0, O, 1, I, or L — the characters people most often misread on a printed card.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
LENGTH = 6


class Command(BaseCommand):
    help = "Generate unique resident codes, create Residents, and write them to a file."

    def add_arguments(self, parser):
        parser.add_argument("count", type=int, nargs="?", default=1000,
                            help="How many codes to generate (default 1000).")
        parser.add_argument("--out", default="codes.txt",
                            help="File to write the codes to (default codes.txt).")
        parser.add_argument("--file-only", action="store_true",
                            help="Only write the file; do NOT create Resident rows.")

    def handle(self, *args, **opts):
        count = opts["count"]
        out = opts["out"]
        if count < 1:
            raise CommandError("count must be at least 1.")

        # Everything already in the DB, compared case-insensitively.
        existing = {
            c.upper()
            for c in Resident.objects.exclude(code__isnull=True).values_list("code", flat=True)
        }

        codes = set()
        while len(codes) < count:
            code = "".join(secrets.choice(ALPHABET) for _ in range(LENGTH))
            if code not in existing and code not in codes:
                codes.add(code)
        codes = sorted(codes)

        if not opts["file_only"]:
            Resident.objects.bulk_create([Resident(code=c) for c in codes])

        with open(out, "w") as f:
            f.write("\n".join(codes) + "\n")

        made = "wrote" if opts["file_only"] else "created %d residents and wrote" % len(codes)
        self.stdout.write(self.style.SUCCESS(
            f"{len(codes)} codes: {made} them to {out}"
        ))
