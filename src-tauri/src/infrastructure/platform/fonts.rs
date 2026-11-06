/// Font family names installed on this machine, sorted case-insensitively.
/// Names starting with "." are private system faces CSS cannot select.
#[cfg(target_os = "macos")]
pub fn families() -> Vec<String> {
    use objc2_core_foundation::CFString;
    // SAFETY: CoreText documents the result as an array of CFStrings.
    let names = unsafe { objc2_core_text::CTFontManagerCopyAvailableFontFamilyNames() };
    let names = unsafe { names.cast_unchecked::<CFString>() };
    let mut families: Vec<String> = names
        .iter()
        .map(|name| name.to_string())
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

// shortcut: macOS-only MVP; other platforms fall back to the preset fonts.
#[cfg(not(target_os = "macos"))]
pub fn families() -> Vec<String> {
    Vec::new()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    #[test]
    fn lists_installed_families_without_private_faces() {
        let families = super::families();
        assert!(families.iter().any(|f| f == "Helvetica"), "{families:?}");
        assert!(families.iter().all(|f| !f.starts_with('.')));
    }
}
