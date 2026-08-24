use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};

use scriptmetakit::OperationCancellation;

use crate::error::CliError;

static ACTIVE_CANCELLATION: OnceLock<Mutex<Option<OperationCancellation>>> = OnceLock::new();
static HANDLER_INSTALLED: OnceLock<Result<(), String>> = OnceLock::new();
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

pub fn install_handler() -> Result<(), CliError> {
    HANDLER_INSTALLED
        .get_or_init(|| {
            ctrlc::set_handler(interrupt_active_operation).map_err(|error| error.to_string())
        })
        .clone()
        .map_err(CliError::Signal)
}

pub struct ActiveCancellationGuard;

impl ActiveCancellationGuard {
    #[must_use]
    pub fn new(cancellation: OperationCancellation) -> Self {
        INTERRUPTED.store(false, Ordering::Release);
        let active = ACTIVE_CANCELLATION.get_or_init(|| Mutex::new(None));
        *active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(cancellation);
        Self
    }
}

impl Drop for ActiveCancellationGuard {
    fn drop(&mut self) {
        let active = ACTIVE_CANCELLATION.get_or_init(|| Mutex::new(None));
        *active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

#[must_use]
pub fn was_interrupted() -> bool {
    INTERRUPTED.load(Ordering::Acquire)
}

fn interrupt_active_operation() {
    INTERRUPTED.store(true, Ordering::Release);
    let active = ACTIVE_CANCELLATION.get_or_init(|| Mutex::new(None));
    let guard = active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(cancellation) = guard.as_ref() {
        cancellation.cancel_current_or_reserved();
    }
}

#[cfg(test)]
mod tests {
    use scriptmetakit::{
        CachePolicy, RefreshPolicy, RootPriority, RootPurpose, RootRegistration, ScanMode,
        ScanRequest, ScriptMetaKitConfig, ScriptMetaKitEngine, WatchPolicy,
    };

    use super::{ActiveCancellationGuard, interrupt_active_operation, was_interrupted};

    #[test]
    fn interrupt_cancels_the_reserved_operation_without_waiting() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("Script.jsx"), "alert('test');").expect("script fixture");
        let mut engine =
            ScriptMetaKitEngine::new(ScriptMetaKitConfig::new("Test", "Test")).expect("engine");
        engine
            .set_roots(vec![RootRegistration {
                root_id: "root".into(),
                path: temp.path().to_path_buf(),
                display_name: None,
                purpose: RootPurpose::MetadataCatalog,
                watch_policy: WatchPolicy::Disabled,
                cache_policy: CachePolicy::Disabled,
                refresh_policy: RefreshPolicy::ManualOnly,
                priority: RootPriority::UserInitiated,
            }])
            .expect("roots");
        let cancellation = engine.cancellation_token();
        let _reservation = cancellation.reserve_next_operation();
        let _active = ActiveCancellationGuard::new(cancellation);

        interrupt_active_operation();
        let result = engine
            .scan_roots(ScanRequest::all(ScanMode::MetadataOnly))
            .expect("cancelled scan result");

        assert!(was_interrupted());
        assert!(result.operation.cancelled);
    }
}
