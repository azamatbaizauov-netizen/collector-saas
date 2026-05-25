interface Props {
  params: Promise<{ id: string }>;
}

export default async function ContactWidgetPage({ params }: Props) {
  const { id } = await params;

  return (
    <div className="p-4 space-y-3">
      <h1 className="font-semibold text-base">Дебиторка — контакт {id}</h1>
      <p className="text-sm text-gray-500">Виджет в разработке.</p>
    </div>
  );
}
