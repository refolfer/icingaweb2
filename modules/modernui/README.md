# Modern UI module

This module owns the versioned backend for the operator workspace extensions. Its schema is
independent of the Icinga Web 2 core schema and currently provides incident assignments and
host group responsibility metadata.

Enable it with `icingacli module enable modernui`. Apply database migrations through the
versioned deployment package rather than inserting custom versions into `icingaweb_schema`.
