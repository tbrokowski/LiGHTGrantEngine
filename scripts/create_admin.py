#!/usr/bin/env python3
"""Create the initial admin user."""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

def main(email: str, name: str, password: str):
    import sqlalchemy as sa
    from sqlalchemy.orm import Session
    from passlib.context import CryptContext
    from app.config import get_settings

    settings = get_settings()
    engine = sa.create_engine(settings.database_url)
    pwd = CryptContext(schemes=["bcrypt"]).hash(password)

    with Session(engine) as db:
        db.execute(
            sa.text("""
                INSERT INTO users (id, name, email, hashed_password, role, is_active, notification_preferences)
                VALUES (:id, :name, :email, :pwd, 'admin', true, '{}')
                ON CONFLICT (email) DO UPDATE SET hashed_password = :pwd, role = 'admin'
            """),
            {"id": str(uuid.uuid4()), "name": name, "email": email, "pwd": pwd}
        )
        db.commit()
    print(f"Admin user created: {email}")

if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python scripts/create_admin.py EMAIL NAME PASSWORD")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
