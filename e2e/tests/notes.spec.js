const { test, expect } = require('@playwright/test');

const unique = (label) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

test.describe('flujo principal', () => {
  test('con lista vacía muestra el mensaje de bienvenida', async ({ page }) => {
    await page.route('**/api/notes', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'memory', notes: [] }) }));
    await page.goto('/');
    await expect(page.getByText('Aún no hay notas')).toBeVisible();
    await expect(page.locator('#mode')).toContainText('memoria');
  });

  test('publicar una nota la muestra, confirma y limpia el formulario', async ({ page }) => {
    const text = unique('Nota E2E');
    await page.goto('/');
    await page.getByLabel('Nombre (opcional)').fill('Ana');
    await page.getByLabel('Nota (obligatoria)').fill(text);
    await page.getByRole('button', { name: 'Publicar' }).click();

    await expect(page.getByRole('status')).toHaveText('Nota publicada');
    await expect(page.getByLabel('Nota (obligatoria)')).toHaveValue('');
    await expect(page.locator('#count')).toHaveText('0 / 280 caracteres');
    const item = page.getByRole('listitem').filter({ hasText: text });
    await expect(item).toBeVisible();
    await expect(item.getByText('Ana')).toBeVisible();
  });

  test('las notas publicadas siguen ahí al recargar', async ({ page }) => {
    const text = unique('Persistente');
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(text);
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText(text)).toBeVisible();
    await page.reload();
    await expect(page.getByText(text)).toBeVisible();
  });

  test('sin nombre se publica como "anónimo"', async ({ page }) => {
    const text = unique('Sin nombre');
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(text);
    await page.getByRole('button', { name: 'Publicar' }).click();
    const item = page.getByRole('listitem').filter({ hasText: text });
    await expect(item.getByText('anónimo')).toBeVisible();
  });

  test('el campo de nota es obligatorio y no envía nada vacío', async ({ page }) => {
    let posts = 0;
    page.on('request', (r) => { if (r.method() === 'POST') posts++; });
    await page.goto('/');
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByLabel('Nota (obligatoria)')).toBeFocused();
    expect(posts).toBe(0);
  });

  test('el contador cuenta caracteres (un emoji cuenta como uno)', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill('hola 😀');
    await expect(page.locator('#count')).toHaveText('6 / 280 caracteres');
  });
});

test.describe('teclado y foco', () => {
  test('el orden de tab es nombre, nota, publicar; el honeypot no recibe foco', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Nombre (opcional)')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Nota (obligatoria)')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement.name)).not.toBe('hp_check');
  });

  test('enviar con Enter en el botón mantiene el foco en el botón', async ({ page }) => {
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 250));
      await route.continue();
    });
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(unique('Teclado'));
    const button = page.getByRole('button', { name: 'Publicar' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toBeFocused(); // con `disabled` el foco se perdería
    await expect(page.getByRole('status')).toHaveText('Nota publicada');
    await expect(button).toBeFocused();
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('doble clic rápido envía una sola nota', async ({ page }) => {
    const posts = [];
    await page.route('**/api/notes', async (route) => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().postData());
        await new Promise((r) => setTimeout(r, 300));
      }
      await route.continue();
    });
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(unique('Doble clic'));
    await page.getByRole('button', { name: 'Publicar' }).dblclick();
    await expect(page.getByRole('status')).toHaveText('Nota publicada');
    expect(posts).toHaveLength(1);
  });
});

test.describe('errores del servidor', () => {
  const cases = [
    { status: 429, error: 'Demasiadas notas, intenta de nuevo en un minuto' },
    { status: 400, error: 'La nota no puede estar vacía' },
    { status: 500, error: 'Error interno del servidor' },
  ];

  for (const { status, error } of cases) {
    test(`un ${status} muestra el mensaje y deja reintentar`, async ({ page }) => {
      await page.route('**/api/notes', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
      });
      await page.goto('/');
      await page.getByLabel('Nota (obligatoria)').fill('texto que no debe perderse');
      const button = page.getByRole('button', { name: 'Publicar' });
      await button.click();

      await expect(page.getByRole('alert')).toHaveText(error);
      await expect(page.getByRole('status')).toBeEmpty();
      await expect(page.getByLabel('Nota (obligatoria)')).toHaveValue('texto que no debe perderse');
      await expect(button).not.toHaveAttribute('aria-disabled', 'true');
    });
  }

  test('el error se limpia al reintentar con éxito', async ({ page }) => {
    let first = true;
    await page.route('**/api/notes', (route) => {
      if (route.request().method() === 'POST' && first) {
        first = false;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Error interno del servidor"}' });
      }
      return route.continue();
    });
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(unique('Reintento'));
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Error interno del servidor');
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByRole('status')).toHaveText('Nota publicada');
    await expect(page.getByRole('alert')).toBeEmpty();
  });
});

test.describe('seguridad', () => {
  test('el HTML y los scripts en una nota se muestran como texto y no se ejecutan', async ({ page }) => {
    const marker = unique('xss');
    const payload = `${marker} <img src=x onerror="window.__xss=1"><script>window.__xss=1</script> "q" 'a' &amp;`;
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(payload);
    await page.getByLabel('Nombre (opcional)').fill('<b onmouseover="window.__xss=1">yo</b>');
    await page.getByRole('button', { name: 'Publicar' }).click();

    const item = page.getByRole('listitem').filter({ hasText: marker });
    await expect(item).toBeVisible();
    await expect(item).toContainText('<img src=x onerror="window.__xss=1"><script>');
    await expect(item).toContainText('<b onmouseover="window.__xss=1">yo</b>');
    expect(await item.locator('img, script, b').count()).toBe(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('un bot que rellena el campo oculto no publica nada', async ({ page }) => {
    const text = unique('Spam de bot');
    await page.goto('/');
    await page.getByLabel('Nota (obligatoria)').fill(text);
    await page.evaluate(() => { document.querySelector('input[name="hp_check"]').value = 'http://spam.example'; });
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByRole('status')).toHaveText('Nota publicada'); // al bot se le simula éxito
    await page.reload();
    await expect(page.locator('#mode')).toContainText('memoria'); // la lista ya cargó
    await expect(page.getByText(text)).toHaveCount(0);
  });
});

test.describe('diseño adaptable', () => {
  for (const width of [320, 390, 768]) {
    test(`sin desplazamiento horizontal a ${width}px (equivale a zoom ${Math.round((1280 / width) * 100)}%)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.route('**/api/notes', (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ mode: 'supabase', notes: [{ id: 1, author: 'A'.repeat(40), body: 'palabra'.repeat(40), created_at: '2026-10-24T21:13:30Z' }] }),
        }));
      await page.goto('/');
      await expect(page.getByRole('listitem')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
