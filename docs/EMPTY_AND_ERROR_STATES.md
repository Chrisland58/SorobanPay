# Empty, Loading, Error, and Filtered States

Data-backed views in SorobanPay distinguish four states so users can tell the difference between an empty dataset, an in-flight request, a failed request, and a filter that matched no records:

1. **Loading (`SkeletonList` / `DataTable isLoading`)**: Uses `role="status"` with `aria-busy="true"` and skeleton placeholders.
2. **Error (`ErrorState` / `DataTable error`)**: Uses `role="alert"` (`data-state="error"`) with a **Retry** action. Retrying preserves active filters and form inputs.
3. **Network / Account Mismatch (`NetworkMismatchState`)**: Uses `role="alert"` (`data-state="network-mismatch"`) with **Switch Network** and optional **Reconnect Wallet** actions.
4. **Filtered No-Results (`FilteredEmptyState` / `DataTable isFiltered`)**: Uses `role="status"` (`data-state="filtered"`) with a **Clear Filters** action.
5. **True Empty (`EmptyState` / `DataTable emptyMessage`)**: Uses `role="status"` (`data-state="empty"`) with a contextual primary CTA.
