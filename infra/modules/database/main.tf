##############################################################################
# RDS Postgres + the application role.
#
# The role attributes here are a security control, not configuration. RLS is
# bypassed by superusers and BYPASSRLS roles regardless of FORCE ROW LEVEL
# SECURITY, so an application connecting as the wrong role has no tenant
# isolation at all while every policy still looks correctly configured.
#
# Two roles, deliberately separate:
#   migrator — owns the schema, runs migrations, never serves traffic
#   app      — NOSUPERUSER / NOBYPASSRLS / non-owner, serves all traffic
#
# See docs/03-engineering/security.md §3.
##############################################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws        = { source = "hashicorp/aws", version = "~> 5.0" }
    postgresql = { source = "cyrilgdn/postgresql", version = "~> 1.22" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "allocated_storage" {
  type    = number
  default = 100
}

resource "random_password" "app" {
  length  = 48
  special = false
}

resource "random_password" "migrator" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "this" {
  name       = "ledgeriq-${var.environment}"
  subnet_ids = var.subnet_ids
}

resource "aws_db_instance" "this" {
  identifier     = "ledgeriq-${var.environment}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.allocated_storage * 4
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.database.arn

  db_name  = "ledgeriq"
  username = "ledgeriq_migrator"
  password = random_password.migrator.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false

  # RPO 15 min / RTO 4h, per docs/03-engineering/deployment.md §5. The DR drill is
  # quarterly and restores into a scratch environment, because an untested backup
  # is a hypothesis rather than a recovery plan.
  multi_az                        = var.environment == "production"
  backup_retention_period         = 30
  backup_window                   = "07:00-08:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.environment == "production"
  skip_final_snapshot             = var.environment != "production"
  final_snapshot_identifier       = "ledgeriq-${var.environment}-final"
  enabled_cloudwatch_logs_exports = ["postgresql"]
  performance_insights_enabled    = true
  auto_minor_version_upgrade      = true

  tags = {
    Environment = var.environment
    Service     = "ledgeriq"
    DataClass   = "financial"
  }
}

resource "aws_kms_key" "database" {
  description             = "ledgeriq-${var.environment} database encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_security_group" "database" {
  name   = "ledgeriq-${var.environment}-db"
  vpc_id = var.vpc_id

  # Ingress is granted per-service via aws_security_group_rule, not opened here.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

##############################################################################
# The application role.
#
# NOSUPERUSER and NOBYPASSRLS are load-bearing. The application asserts both at
# startup (apps/api/src/startup.ts) and refuses to boot otherwise, and the
# tenancy test suite asserts them before running any isolation case — otherwise
# those cases would pass for the wrong reason.
##############################################################################

resource "postgresql_role" "app" {
  name     = "ledgeriq_app"
  login    = true
  password = random_password.app.result

  superuser   = false
  bypass_row_level_security = false
  create_database = false
  create_role     = false
  inherit         = true

  # Connection limit sized to the ECS task count × pool size, with headroom.
  connection_limit = 200
}

resource "aws_secretsmanager_secret" "app_db" {
  name       = "ledgeriq/${var.environment}/database/app"
  kms_key_id = aws_kms_key.database.arn
}

resource "aws_secretsmanager_secret_version" "app_db" {
  secret_id = aws_secretsmanager_secret.app_db.id
  secret_string = jsonencode({
    username = postgresql_role.app.name
    password = random_password.app.result
    host     = aws_db_instance.this.address
    port     = aws_db_instance.this.port
    dbname   = aws_db_instance.this.db_name
    url      = "postgres://${postgresql_role.app.name}:${random_password.app.result}@${aws_db_instance.this.endpoint}/${aws_db_instance.this.db_name}?sslmode=require"
  })
}

output "endpoint" { value = aws_db_instance.this.endpoint }
output "app_secret_arn" { value = aws_secretsmanager_secret.app_db.arn }
output "security_group_id" { value = aws_security_group.database.id }
