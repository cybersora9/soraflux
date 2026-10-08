// Bez okna konsoli w wydaniu na Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    soraconverter_lib::run()
}
