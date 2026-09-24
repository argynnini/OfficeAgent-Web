/** Excel のシート切り替えイベントを購読する (Excel ホストでのみ呼び出すこと) */
export async function watchWorksheetActivated(handler: () => void): Promise<void> {
  await Excel.run(async (context) => {
    context.workbook.worksheets.onActivated.add(async () => handler());
    await context.sync();
  });
}
