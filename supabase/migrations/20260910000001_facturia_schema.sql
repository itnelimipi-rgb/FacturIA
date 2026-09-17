-- ==============================================================================
-- FacturIA - Migración de Base de Datos (Supabase / PostgreSQL)
-- Esquema relacional con Row-Level Security (RLS) y validaciones fiscales
-- ==============================================================================

-- 1. EXTENSIONES Y ENUMS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum para el estado determinista de conciliación
DO $$ BEGIN
    CREATE TYPE reconciliation_status AS ENUM ('conciliado', 'ambiguo', 'discrepancia');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. TABLA: PROFILES
-- Almacena la información fiscal del usuario/empresa (RESICO / Actividad Empresarial)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    rfc TEXT NOT NULL,
    business_name TEXT NOT NULL,
    regime_code TEXT NOT NULL, -- Ej: '626' (RESICO), '612' (Personas Físicas con Actividades Empresariales)
    encrypted_ciec BYTEA NULL,  -- Credencial CIEC cifrada en reposo con AES-256-GCM
    encrypted_csd BYTEA NULL,   -- Certificado de Sello Digital cifrado en reposo
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    -- Validación estricta con RegEx SAT Anexo 20 para Personas Físicas (4 letras) y Morales (3 letras)
    CONSTRAINT check_valid_rfc CHECK (
        rfc ~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$'
    )
);

-- 3. TABLA: EFOS_BLACKLIST
-- Lista negra del SAT conforme al Artículo 69-B del Código Fiscal de la Federación
CREATE TABLE IF NOT EXISTS public.efos_blacklist (
    rfc TEXT PRIMARY KEY,
    nombre_razon_social TEXT NOT NULL,
    situacion TEXT NOT NULL CHECK (situacion IN ('Presunto', 'Desvirtuado', 'Definitivo', 'Sentencia Favorable')),
    fecha_publicacion_dof DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. TABLA: CFDI_RECORDS
-- Comprobantes Fiscales Digitales por Internet (CFDI 4.0 / 3.3)
CREATE TABLE IF NOT EXISTS public.cfdi_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    uuid_sat UUID UNIQUE NOT NULL,
    rfc_emisor TEXT NOT NULL,
    rfc_receptor TEXT NOT NULL,
    total NUMERIC(12, 2) NOT NULL,
    subtotal NUMERIC(12, 2) NOT NULL,
    iva NUMERIC(12, 2) DEFAULT 0.00,
    retenciones NUMERIC(12, 2) DEFAULT 0.00,
    fecha_emision TIMESTAMP WITH TIME ZONE NOT NULL,
    tipo_comprobante CHAR(1) NOT NULL CHECK (tipo_comprobante IN ('I', 'E', 'T', 'N', 'P')), -- I: Ingreso, E: Egreso
    status_sat TEXT NOT NULL DEFAULT 'vigente' CHECK (status_sat IN ('vigente', 'cancelado')),
    is_efos BOOLEAN NOT NULL DEFAULT FALSE,
    raw_xml TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,

    CONSTRAINT check_totals_positive CHECK (total >= 0 AND subtotal >= 0)
);

-- 5. TABLA: BANK_TRANSACTIONS
-- Movimientos bancarios obtenidos vía conectores Open Banking (Belvo/Prometeo)
CREATE TABLE IF NOT EXISTS public.bank_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    amount NUMERIC(12, 2) NOT NULL, -- Positivo = Ingreso / Cobro, Negativo = Egreso / Gasto
    currency VARCHAR(3) NOT NULL DEFAULT 'MXN',
    date DATE NOT NULL,
    description TEXT NOT NULL,
    status reconciliation_status NOT NULL DEFAULT 'discrepancia',
    matched_cfdi_id UUID NULL REFERENCES public.cfdi_records(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. ÍNDICES DE ALTO RENDIMIENTO PARA CONSULTAS DE CONCILIACIÓN
CREATE INDEX IF NOT EXISTS idx_bank_transactions_user_status ON public.bank_transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON public.bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_amount ON public.bank_transactions(amount);
CREATE INDEX IF NOT EXISTS idx_cfdi_records_user_date ON public.cfdi_records(user_id, fecha_emision);
CREATE INDEX IF NOT EXISTS idx_cfdi_records_total ON public.cfdi_records(total);
CREATE INDEX IF NOT EXISTS idx_cfdi_records_rfc_emisor ON public.cfdi_records(rfc_emisor);
CREATE INDEX IF NOT EXISTS idx_efos_blacklist_rfc ON public.efos_blacklist(rfc);

-- 7. TRIGGER AUTOMÁTICO: DETECCIÓN DE EFOS AL INSERTAR O ACTUALIZAR CFDI
CREATE OR REPLACE FUNCTION public.check_cfdi_efos()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.efos_blacklist 
        WHERE rfc = NEW.rfc_emisor AND situacion = 'Definitivo'
    ) THEN
        NEW.is_efos := TRUE;
    ELSE
        NEW.is_efos := FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_cfdi_efos ON public.cfdi_records;
CREATE TRIGGER trg_check_cfdi_efos
BEFORE INSERT OR UPDATE OF rfc_emisor ON public.cfdi_records
FOR EACH ROW EXECUTE FUNCTION public.check_cfdi_efos();

-- 8. ROW LEVEL SECURITY (RLS) - AISLAMIENTO MULTI-TENANT ESTRICTO
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfdi_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.efos_blacklist ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Users can view and update their own profile"
    ON public.profiles
    FOR ALL
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Políticas para bank_transactions
CREATE POLICY "Users can manage their own bank transactions"
    ON public.bank_transactions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Políticas para cfdi_records
CREATE POLICY "Users can manage their own CFDIs"
    ON public.cfdi_records
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Políticas para efos_blacklist (Lectura pública para cruce de listas de seguridad)
CREATE POLICY "Public read-only for EFOS blacklist"
    ON public.efos_blacklist
    FOR SELECT
    TO authenticated
    USING (true);
