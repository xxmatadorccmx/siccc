-- Trigger PEPS/FIFO: Salidas de inventario respetando orden FIFO
CREATE OR REPLACE FUNCTION sicc.fifo_inventario() RETURNS TRIGGER AS $$
DECLARE
    cantidad_a_deducir NUMERIC(18,8) := NEW.cantidad;
    batch RECORD;
BEGIN
    -- Iterar sobre los batches más antiguos
    FOR batch IN
        SELECT * FROM sicc.inventario_batches
        WHERE inventario_id = NEW.inventario_id AND cantidad_remanente > 0
        ORDER BY creado_en ASC
    LOOP
        IF cantidad_a_deducir <= batch.cantidad_remanente THEN
            -- Deduce completamente del batch actual
            UPDATE sicc.inventario_batches
            SET cantidad_remanente = cantidad_remanente - cantidad_a_deducir
            WHERE id = batch.id;
            RETURN NEW;
        ELSE
            -- Consumir completamente este batch y continuar
            cantidad_a_deducir := cantidad_a_deducir - batch.cantidad_remanente;
            UPDATE sicc.inventario_batches
            SET cantidad_remanente = 0
            WHERE id = batch.id;
        END IF;
    END LOOP;

    RAISE EXCEPTION 'Cantidad excede inventario disponible';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fifo_inventario
BEFORE INSERT OR UPDATE ON sicc.inventarios
FOR EACH ROW
EXECUTE FUNCTION sicc.fifo_inventario();

-- Trigger Partida Doble en accounting_journal
CREATE OR REPLACE FUNCTION sicc.partida_doble() RETURNS TRIGGER AS $$
BEGIN
    -- Confirmar que los CARGOS y ABONOS balancean
    IF (NEW.tipo_movimiento = 'CARGO' AND NEW.monto < 0) OR
       (NEW.tipo_movimiento = 'ABONO' AND NEW.monto > 0) THEN
        RETURN NEW;
    ELSE
        RAISE EXCEPTION 'Error en partida doble: Cargos deben ser negativos, abonos positivos';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_partida_doble
BEFORE INSERT ON sicc.accounting_journal
FOR EACH ROW
EXECUTE FUNCTION sicc.partida_doble();