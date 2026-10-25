const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const notes = [
  { id: 2, author: 'Héctor Mariano', body: 'Esta es la primer nota de este muro.', created_at: '2026-10-24T21:13:30Z' },
  { id: 1, author: 'anónimo', body: 'Otra nota', created_at: '2026-10-24T20:00:00Z' },
];

async function mockNotes(page, list = notes) {
  await page.route('**/api/notes', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'supabase', notes: list }) });
    }
    return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Demasiadas notas, intenta de nuevo en un minuto' }) });
  });
}

async function expectNoViolations(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

for (const colorScheme of ['light', 'dark']) {
  test.describe(`accesibilidad WCAG 2.1 AA, tema ${colorScheme}`, () => {
    test.use({ colorScheme });

    test('con notas', async ({ page }) => {
      await mockNotes(page);
      await page.goto('/');
      await expect(page.getByRole('listitem')).toHaveCount(2);
      await expectNoViolations(page);
    });

    test('con lista vacía', async ({ page }) => {
      await mockNotes(page, []);
      await page.goto('/');
      await expect(page.getByText('Aún no hay notas')).toBeVisible();
      await expectNoViolations(page);
    });

    test('con mensaje de error visible y campo enfocado', async ({ page }) => {
      await mockNotes(page);
      await page.goto('/');
      await page.getByLabel('Nota (obligatoria)').fill('algo');
      await page.getByRole('button', { name: 'Publicar' }).click();
      await expect(page.getByRole('alert')).toContainText('Demasiadas notas');
      await page.getByLabel('Nombre (opcional)').focus();
      await expectNoViolations(page);
    });
  });
}

test.describe('estructura accesible', () => {
  test('landmarks, encabezados e idioma', async ({ page }) => {
    await mockNotes(page);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Muro de notas');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Notas');
    await expect(page.getByRole('list')).toHaveCount(1);
    await expect(page.locator('time')).toHaveCount(2);
  });

  test('cada campo tiene nombre accesible y el contador lo describe', async ({ page }) => {
    await mockNotes(page);
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Nombre (opcional)' })).toBeVisible();
    const nota = page.getByRole('textbox', { name: 'Nota (obligatoria)' });
    await expect(nota).toHaveAccessibleDescription('0 / 280 caracteres');
  });

  test('el honeypot queda fuera del árbol de accesibilidad', async ({ page }) => {
    await mockNotes(page);
    await page.goto('/');
    await expect(page.getByRole('textbox')).toHaveCount(2);
  });

  test('el foco se distingue visualmente (contorno visible)', async ({ page }) => {
    await mockNotes(page);
    await page.goto('/');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement);
      return { width: parseFloat(s.outlineWidth), style: s.outlineStyle };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });
});
