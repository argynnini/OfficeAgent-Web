export interface WorksheetEventHandlers {
  onAdded?: () => void;
  onDeleted?: () => void;
  onActivated?: () => void;
}

/** Excel のシート追加・削除・切り替えイベントを購読する (Excel ホストでのみ呼び出すこと) */
export async function watchWorksheetEvents(handlers: WorksheetEventHandlers): Promise<void> {
  await Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    if (handlers.onAdded) sheets.onAdded.add(async () => handlers.onAdded!());
    if (handlers.onDeleted) sheets.onDeleted.add(async () => handlers.onDeleted!());
    if (handlers.onActivated) sheets.onActivated.add(async () => handlers.onActivated!());
    await context.sync();
  });
}
