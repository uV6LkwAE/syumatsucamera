from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("cms", "0004_remove_articleoption_article_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cms_option'
          AND column_name = 'default_text'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cms_option'
          AND column_name = 'description'
    ) THEN
        ALTER TABLE cms_option RENAME COLUMN default_text TO description;
    ELSIF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cms_option'
          AND column_name = 'default_text'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cms_option'
          AND column_name = 'description'
    ) THEN
        UPDATE cms_option
        SET description = default_text
        WHERE description IS NULL;
        ALTER TABLE cms_option DROP COLUMN default_text;
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cms_option'
          AND column_name = 'description'
    ) THEN
        ALTER TABLE cms_option ADD COLUMN description text NULL;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'cms_option'
          AND column_name = 'description'
    ) THEN
        ALTER TABLE cms_option ALTER COLUMN description DROP NOT NULL;
    END IF;
END $$;
""",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
