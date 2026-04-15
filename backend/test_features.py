import sys
sys.path.insert(0, ".")
from main import _infer_modules, _infer_features_from_snippets

paths = [
    "$/OnBase/DEV/Core/OnBase.NET/Libraries/Hyland.Core.Workview.Services/Canvas/ObjectService.cs",
    "$/OnBase/DEV/Core/OnBase.NET/WorkView/Hyland.WorkView.InterfaceServices/Services/ItemListEntryService.cs",
]

obj_snippet = (
    "using Hyland.WorkView.InterfaceServices.Interfaces;\n"
    "namespace Hyland.Core.Workview.Services.Canvas\n"
    "{\n"
    "    public class ObjectService : CanvasClientServiceClassBase\n"
    "    {\n"
    "        private static ElementSerializer<IItemListEntry> _favoriteSerializer;\n"
    "        private static ElementSerializer<IItemListEntry> _recentlyViewedSerializer;\n"
    "        private static ElementSerializer<Hyland.Core.Folder> _onBaseFolderSerializer;\n"
    "        static ObjectService()\n"
    "        {\n"
    "            _recentlyViewedSerializer = ElementSerializerFactory.BuildSerializer<IItemListEntry>()\n"
    "                .AddProperty(nameof(IItemListEntry.ID)).RenameTo(\"id\")\n"
    "                .AddProperty(nameof(IItemListEntry.ItemID)).RenameTo(\"objectid\")\n"
    "                .AddProperty(nameof(IItemListEntry.ClassID)).RenameTo(\"classid\")\n"
    "                .CreateSerializer();\n"
    "        }\n"
    "    }\n"
    "}\n"
)

item_snippet = (
    "using Hyland.WorkView.InterfaceServices.Interfaces;\n"
    "namespace Hyland.WorkView.InterfaceServices.Services\n"
    "{\n"
    "    internal class ItemListEntryService : IItemListEntryServicePrivate\n"
    "    {\n"
    "        public void RecordAsRecentlyViewed(ISession session, IObject wvObject, long applicationID)\n"
    "        {\n"
    "            if (wvObject.ActiveStatus == ObjectStatus.Inactive) return;\n"
    "            IClass cls = wvObject.Class;\n"
    "            applicationID = cls.Applications[0].ID;\n"
    "        }\n"
    "        public void UpdateFavorites(ISession session, long objectID) { }\n"
    "        public IItemListEntry GetRecentlyViewedItems(ISession session) { return null; }\n"
    "        public bool IsRecentlyViewedEnabled(IApplicationProvider appProvider) { return true; }\n"
    "        public int GetMaxRecentlyViewedCount(IApplicationProvider appProvider) { return 10; }\n"
    "    }\n"
    "}\n"
)

files = [
    {"server_path": paths[0], "snippet": obj_snippet},
    {"server_path": paths[1], "snippet": item_snippet},
]

print("=== impacted_modules (path-based) ===")
for m in _infer_modules(paths):
    print(f"  {m}")

print()
print("=== impacted_features (code-based) ===")
for f in _infer_features_from_snippets(files):
    print(f"  {f}")
